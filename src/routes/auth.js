import { Router } from 'express';
import crypto from 'node:crypto';
import { EmailVerifications, PasswordResets, Users, Audit } from '../db.js';
import {
  COOKIE,
  clearSessionCookie,
  hashPassword,
  parseCookies,
  requireAuth,
  revokeSessionToken,
  revokeUserSessions,
  secureCookiesEnabled,
  setSessionCookie,
  verifyPassword
} from '../auth.js';
import { providers, enabledProviders } from '../oauth.js';

const r = Router();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** First user ever becomes admin; configured ADMIN_EMAILS are admins too. */
function decideRole(email) {
  if (Users.count() === 0) return 'admin';
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return 'admin';
  return 'user';
}
const pub = u => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  provider: u.provider,
  email_verified_at: u.email_verified_at || null
});

/* ---- which login methods are available ---- */
r.get('/providers', (_req, res) => res.json({ password: true, oauth: enabledProviders() }));

/* ---- current session ---- */
r.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  res.json(req.user);
});

/* ---- email + password ---- */
r.post('/register', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const name = (req.body?.name || '').trim();
  const password = req.body?.password || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (Users.getByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const role = decideRole(email);
  const u = Users.create({ email, name: name || email.split('@')[0], role, passwordHash: hashPassword(password), provider: 'local' });
  EmailVerifications.issue(u.id);
  Audit.log(u.name, u.role, 'REGISTER', `${email} (${role})`);
  setSessionCookie(res, u.id, req);
  res.status(201).json(pub(u));
});

r.post('/login', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  const u = Users.getByEmail(email);
  // Clear, specific messages (the product owner prefers clarity here over
  // account-enumeration hardening).
  if (!u) {
    Audit.log('Unknown', '', 'LOGIN_FAILED', `${email || '(blank)'} | no account`);
    return res.status(401).json({ error: 'No account found with that email' });
  }
  if (u.provider !== 'local' || !u.password_hash) {
    Audit.log(u.name || u.email, u.role, 'LOGIN_FAILED', `${email} | provider ${u.provider}`);
    return res.status(401).json({ error: `This account uses ${u.provider} sign-in — use the ${u.provider} button above` });
  }
  if (!verifyPassword(password, u.password_hash)) {
    Audit.log(u.name || u.email, u.role, 'LOGIN_FAILED', `${email} | bad password`);
    return res.status(401).json({ error: 'Incorrect password' });
  }
  Audit.log(u.name, u.role, 'LOGIN', email);
  setSessionCookie(res, u.id, req);
  res.json(pub(u));
});

r.post('/logout', (req, res) => {
  if (req.user) Audit.log(req.user.name, req.user.role, 'LOGOUT', req.user.email || '');
  revokeSessionToken(parseCookies(req)[COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.post('/password-reset', (req, res) => {
  const token = (req.body?.token || '').trim();
  const password = req.body?.password || '';
  if (token) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const row = PasswordResets.consume(token);
    if (!row) return res.status(400).json({ error: 'Password reset token is invalid or expired' });
    const u = Users.setPassword(row.user_id, hashPassword(password));
    revokeUserSessions(u.id);
    Audit.log(u.name || u.email, u.role, 'PASSWORD_RESET_COMPLETE', u.email || u.id);
    return res.json({ ok: true });
  }

  const email = (req.body?.email || '').trim().toLowerCase();
  const u = Users.getByEmail(email);
  let issued = null;
  if (u && u.provider === 'local') {
    issued = PasswordResets.issue(u.id);
    Audit.log(u.name || u.email, u.role, 'PASSWORD_RESET_REQUEST', email);
  } else {
    Audit.log('Unknown', '', 'PASSWORD_RESET_REQUEST', `${email || '(blank)'} | no local account`);
  }
  const out = { ok: true, message: 'If a local account exists, a reset token has been issued.' };
  if (issued && process.env.PASSWORD_RESET_EXPOSE_TOKEN === 'true') out.token = issued.token;
  res.json(out);
});

r.post('/verify-email', (req, res) => {
  const token = (req.body?.token || '').trim();
  if (token) {
    const row = EmailVerifications.consume(token);
    if (!row) return res.status(400).json({ error: 'Email verification token is invalid or expired' });
    const u = Users.markEmailVerified(row.user_id);
    Audit.log(u.name || u.email, u.role, 'VERIFY_EMAIL', u.email || u.id);
    return res.json({ ok: true, user: pub(u) });
  }
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const issued = EmailVerifications.issue(req.user.id);
  Audit.log(req.user.name, req.user.role, 'REQUEST_EMAIL_VERIFICATION', req.user.email || req.user.id);
  const out = { ok: true, message: 'Verification token issued.' };
  if (process.env.EMAIL_VERIFICATION_EXPOSE_TOKEN === 'true') out.token = issued.token;
  res.json(out);
});

r.post('/sessions/revoke', requireAuth, (req, res) => {
  const currentToken = parseCookies(req)[COOKIE];
  const all = req.body?.all === true;
  const count = all ? revokeUserSessions(req.user.id) : revokeSessionToken(currentToken);
  Audit.log(req.user.name, req.user.role, all ? 'REVOKE_ALL_SESSIONS' : 'REVOKE_SESSION', req.user.email || req.user.id);
  if (!all) clearSessionCookie(res);
  res.json({ ok: true, revoked: count });
});

/* ---- OAuth (Google / GitHub / WeChat) ---- */
r.get('/oauth/:provider/start', (req, res) => {
  const p = providers[req.params.provider];
  if (!p || !p.enabled()) return res.status(404).send('Provider not enabled');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `sv_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureCookiesEnabled() ? '; Secure' : ''}`);
  res.redirect(p.authorizeUrl(state, req));
});

r.get('/oauth/:provider/callback', async (req, res) => {
  const p = providers[req.params.provider];
  if (!p || !p.enabled()) return res.status(404).send('Provider not enabled');
  const { code, state } = req.query;
  const expected = parseCookies(req)['sv_oauth_state'];
  if (!code || !state || !expected || state !== expected) return res.status(400).send('Invalid OAuth state');
  try {
    const prof = await p.profile(code, req);      // { providerId, email, name }
    let u = Users.getByProvider(req.params.provider, prof.providerId);
    if (!u && prof.email) u = Users.getByEmail(prof.email); // link existing account by verified email
    if (!u) {
      const role = decideRole(prof.email);
      u = Users.create({ email: prof.email, name: prof.name, role, provider: req.params.provider, providerId: prof.providerId });
      if (prof.email) Users.markEmailVerified(u.id);
      Audit.log(u.name, u.role, 'REGISTER', `${req.params.provider} (${role})`);
    }
    Audit.log(u.name, u.role, 'LOGIN', `${req.params.provider}`);
    clearOAuthState(res);
    setSessionCookie(res, u.id, req);
    res.redirect('/');
  } catch (e) {
    res.status(502).send('OAuth sign-in failed: ' + e.message);
  }
});
function clearOAuthState(res) {
  const existing = res.getHeader('Set-Cookie');
  const clear = 'sv_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
  res.setHeader('Set-Cookie', existing ? [].concat(existing, clear) : clear);
}

export default r;
