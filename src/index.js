/**
 * SciVox ELN — application server.
 * Serves the REST API under /api and the static SPA from /public.
 *
 * Auth model: login is required for all data. Identity is derived server-side
 * from a signed session cookie (see src/auth.js) — never trusted from client
 * headers. Public endpoints: the SPA static files, /api/health and /api/auth/*.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { migrate } from './db.js';
import { seedIfEmpty } from './seed.js';
import { authenticate, requireAuth } from './auth.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import orgs from './routes/orgs.js';
import projects from './routes/projects.js';
import experiments from './routes/experiments.js';
import entries from './routes/entries.js';
import plans from './routes/plans.js';
import inventory from './routes/inventory.js';
import calendar from './routes/calendar.js';
import audit from './routes/audit.js';
import stt from './routes/stt.js';
import uploads from './routes/uploads.js';
import ai from './routes/ai.js';
import references from './routes/references.js';
import search from './routes/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function trustProxyValue(value) {
  if (!value || value === 'false' || value === '0') return false;
  if (value === 'true') return 1;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

// Initialise DB
migrate();
if (process.env.SEED !== 'false') seedIfEmpty();

export const app = express();
app.disable('x-powered-by');
const trustProxy = trustProxyValue(process.env.TRUST_PROXY);
if (trustProxy) app.set('trust proxy', trustProxy);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  next();
});

if (process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    const isLocal = /^localhost(?::|$)|^127\.0\.0\.1(?::|$)|^\[::1\](?::|$)/.test(host);
    if (!host || req.secure || isLocal) return next();
    res.redirect(308, `https://${host}${req.originalUrl}`);
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(authenticate); // populates req.user from the session cookie (or null)

// Public endpoints
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'scivox-eln', time: new Date().toISOString() }));
app.use('/api/auth', auth);
app.use('/api/calendar', calendar);

// Protected API (login required)
app.use('/api/experiments', requireAuth, experiments);
app.use('/api/orgs', requireAuth, orgs);
app.use('/api/projects', requireAuth, projects);
app.use('/api/entries', requireAuth, entries);
app.use('/api/plans', requireAuth, plans);
app.use('/api/inventory', requireAuth, inventory);
app.use('/api/audit', requireAuth, audit);
app.use('/api/stt', requireAuth, stt);
app.use('/api/uploads', requireAuth, uploads);
app.use('/api/ai', requireAuth, ai);
app.use('/api/references', requireAuth, references);
app.use('/api/search', requireAuth, search);
app.use('/api/users', requireAuth, users); // users routes further require the admin role

// Uploaded scans (login required to view)
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

// Static SPA (public; the app calls /api/auth/me and shows the login screen if needed)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api|uploads).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// JSON error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

export function start() {
  return app.listen(PORT, HOST, () => {
    const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`SciVox ELN running on http://${shownHost}:${PORT}  (bound: ${HOST}, data: ${DATA_DIR})`);
  });
}

if (process.env.SCIVOX_NO_LISTEN !== 'true') start();
