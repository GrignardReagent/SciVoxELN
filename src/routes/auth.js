import { Router } from 'express';
import crypto from 'node:crypto';
import { Users, Audit } from '../db.js';
import { hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, parseCookies } from '../auth.js';
import { providers, enabledProviders } from '../oauth.js';

const r = Router();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** First user ever becomes admin; configured ADMIN_EMAILS are admins too. */
function decideRole(email) {
  if (Users.count() === 0) return 'admin';
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return 'admin';
  return 'user';
}
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, provider: u.provider });

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
  Audit.log(u.name, u.role, 'REGISTER', `${email} (${role})`);
  setSessionCookie(res, u.id);
  res.status(201).json(pub(u));
});

r.post('/login', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  const u = Users.getByEmail(email);
  if (!u || u.provider !== 'local' || !verifyPassword(password, u.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  Audit.log(u.name, u.role, 'LOGIN', email);
  setSessionCookie(res, u.id);
  res.json(pub(u));
});

r.post('/logout', (req, res) => {
  if (req.user) Audit.log(req.user.name, req.user.role, 'LOGOUT', req.user.email || '');
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---- OAuth (Google / GitHub / WeChat) ---- */
r.get('/oauth/:provider/start', (req, res) => {
  const p = providers[req.params.provider];
  if (!p || !p.enabled()) return res.status(404).send('Provider not enabled');
  const state = crypto.randomBytes(16).toString('hex');
  const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `sv_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure ? '; Secure' : ''}`);
  res.redirect(p.authorizeUrl(state));
});

r.get('/oauth/:provider/callback', async (req, res) => {
  const p = providers[req.params.provider];
  if (!p || !p.enabled()) return res.status(404).send('Provider not enabled');
  const { code, state } = req.query;
  const expected = parseCookies(req)['sv_oauth_state'];
  if (!code || !state || !expected || state !== expected) return res.status(400).send('Invalid OAuth state');
  try {
    const prof = await p.profile(code);           // { providerId, email, name }
    let u = Users.getByProvider(req.params.provider, prof.providerId);
    if (!u && prof.email) u = Users.getByEmail(prof.email); // link existing account by verified email
    if (!u) {
      const role = decideRole(prof.email);
      u = Users.create({ email: prof.email, name: prof.name, role, provider: req.params.provider, providerId: prof.providerId });
      Audit.log(u.name, u.role, 'REGISTER', `${req.params.provider} (${role})`);
    }
    Audit.log(u.name, u.role, 'LOGIN', `${req.params.provider}`);
    clearOAuthState(res);
    setSessionCookie(res, u.id);
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
