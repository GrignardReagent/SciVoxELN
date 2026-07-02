/**
 * Authentication primitives — dependency-light, built on node:crypto.
 *
 *  - Passwords: scrypt with a per-user random salt (constant-time compare).
 *  - Sessions: a signed, HttpOnly cookie carrying the user id + expiry, HMAC'd
 *    with a server secret. No server-side session store needed; stateless.
 *  - Roles: a simple hierarchy (user < admin) enforced by requireRole().
 *
 * This replaces the earlier stubbed identity middleware. Identity is now derived
 * server-side from the session cookie — never trusted from client headers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Users } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

export const ROLES = { user: 1, admin: 2 };
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
export function makeToken(userId) {
  const payload = b64u(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return `${payload}.${sign(payload)}`;
}
export function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expect = sign(payload);
  const A = Buffer.from(mac), B = Buffer.from(expect);
  if (A.length !== B.length || !crypto.timingSafeEqual(A, B)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!uid || !exp || Date.now() > exp) return null;
    return uid;
  } catch { return null; }
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
export function setSessionCookie(res, userId) {
  const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  const attrs = [
    `${COOKIE}=${makeToken(userId)}`,
    'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (secure) attrs.push('Secure');
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
