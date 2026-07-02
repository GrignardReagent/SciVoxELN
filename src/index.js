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
import experiments from './routes/experiments.js';
import entries from './routes/entries.js';
import plans from './routes/plans.js';
import inventory from './routes/inventory.js';
import audit from './routes/audit.js';
import stt from './routes/stt.js';
import uploads from './routes/uploads.js';
import ai from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialise DB
migrate();
if (process.env.SEED !== 'false') seedIfEmpty();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(authenticate); // populates req.user from the session cookie (or null)

// Public endpoints
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'scivox-eln', time: new Date().toISOString() }));
app.use('/api/auth', auth);

// Protected API (login required)
app.use('/api/experiments', requireAuth, experiments);
app.use('/api/entries', requireAuth, entries);
app.use('/api/plans', requireAuth, plans);
app.use('/api/inventory', requireAuth, inventory);
app.use('/api/audit', requireAuth, audit);
app.use('/api/stt', requireAuth, stt);
app.use('/api/uploads', requireAuth, uploads);
app.use('/api/ai', requireAuth, ai);
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

app.listen(PORT, () => {
  console.log(`SciVox ELN running on http://localhost:${PORT}  (data: ${DATA_DIR})`);
});
