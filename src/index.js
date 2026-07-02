/**
 * SciVox ELN — application server.
 * Serves the REST API under /api and the static SPA from /public.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { migrate } from './db.js';
import { seedIfEmpty } from './seed.js';
import experiments from './routes/experiments.js';
import entries from './routes/entries.js';
import plans from './routes/plans.js';
import inventory from './routes/inventory.js';
import audit from './routes/audit.js';
import stt from './routes/stt.js';
import uploads from './routes/uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialise DB
migrate();
if (process.env.SEED !== 'false') seedIfEmpty();

const app = express();
app.use(express.json({ limit: '2mb' }));

/**
 * Lightweight identity middleware. The SPA sends the acting user's name/role
 * in headers so every write can be attributed in the audit trail. In a
 * production deployment this is where real auth (SSO / JWT / RBAC) plugs in.
 */
app.use((req, _res, next) => {
  req.user = {
    name: decode(req.get('x-user-name')) || 'Unknown',
    role: decode(req.get('x-user-role')) || ''
  };
  next();
});
function decode(v) { try { return v ? decodeURIComponent(v) : ''; } catch { return v || ''; } }

// Health check (useful for Docker / load balancers)
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'scivox-eln', time: new Date().toISOString() }));

// API routes
app.use('/api/experiments', experiments);
app.use('/api/entries', entries);
app.use('/api/plans', plans);
app.use('/api/inventory', inventory);
app.use('/api/audit', audit);
app.use('/api/stt', stt);
app.use('/api/uploads', uploads);

// Static: uploaded images and the SPA
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback (non-API GET → index.html)
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
