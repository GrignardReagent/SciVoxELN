/**
 * Authentication primitives — dependency-light, built on node:crypto.
 *
 *  - Passwords: scrypt with a per-user random salt (constant-time compare).
 *  - Sessions: a signed, HttpOnly cookie backed by a server-side session row,
 *    so admins can revoke sessions immediately.
 *  - Roles: a hierarchy enforced by requireRole().
 *
 * This replaces the earlier stubbed identity middleware. Identity is now derived
 * server-side from the session cookie — never trusted from client headers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions, Users, fingerprint } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

export const ROLES = { viewer: 1, user: 2, scientist: 2, reviewer: 3, admin: 4 };
export const COOKIE = 'sv_session';
const SESSION_DAYS = 7;

/* ---- session secret (persisted so sessions survive restarts) ---- */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session_secret');
  try { return fs.readFileSync(f, 'utf8'); }
  catch {
    const s = crypto.randomBytes(48).toString('hex');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, s, { mode: 0o600 }); } catch {}
    return s;
  }
}
const SECRET = loadSecret();

/* ---- passwords ---- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---- signed session tokens ---- */
const b64u = buf => Buffer.from(buf).toString('base64url');
function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}
export function makeToken(userId, sessionId = crypto.randomUUID(), exp = Date.now() + SESSION_DAYS * 864e5) {
  const payload = b64u(JSON.stringify({ uid: userId, sid: sessionId, exp }));
  return `${payload}.${sign(payload)}`;
}
function readSignedPayload(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expect = sign(payload);
  const A = Buffer.from(mac), B = Buffer.from(expect);
  if (A.length !== B.length || !crypto.timingSafeEqual(A, B)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!parsed.uid || !parsed.sid || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch { return null; }
}
export function readToken(token) {
  const parsed = readSignedPayload(token);
  if (!parsed) return null;
  const session = Sessions.getValid(parsed.sid, fingerprint(token));
  return session ? parsed.uid : null;
}

export function revokeSessionToken(token) {
  const parsed = readSignedPayload(token);
  if (!parsed) return 0;
  return Sessions.revoke(parsed.sid, fingerprint(token));
}

export function revokeUserSessions(userId) {
  return Sessions.revokeUser(userId);
}

/* ---- cookies ---- */
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function secureCookiesEnabled() {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
export function setSessionCookie(res, userId, req = null) {
  const sid = crypto.randomUUID();
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = makeToken(userId, sid, exp);
  Sessions.create({
    id: sid,
    userId,
    tokenHash: fingerprint(token),
    expiresAt: new Date(exp).toISOString(),
    userAgent: req?.headers?.['user-agent'] || '',
    ip: req?.ip || req?.socket?.remoteAddress || ''
  });
  const attrs = [
    `${COOKIE}=${token}`,
    'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (secureCookiesEnabled()) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/* ---- middleware ---- */
/** Populate req.user from the session cookie (or null). Always call first. */
export function authenticate(req, _res, next) {
  req.user = null;
  const uid = readToken(parseCookies(req)[COOKIE]);
  if (uid) {
    const u = Users.getById(uid);
    if (u) req.user = { id: u.id, name: u.name || u.email || 'User', email: u.email, role: u.role };
  }
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}
export function requireRole(minRole) {
  const min = ROLES[minRole] || 1;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if ((ROLES[req.user.role] || 0) < min) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}
