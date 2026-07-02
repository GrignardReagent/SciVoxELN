import { Router } from 'express';
import { Audit } from '../db.js';

const r = Router();

r.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 1000, 10000);
  res.json(Audit.list(limit));
});

/** Export the full audit trail as CSV. */
r.get('/export.csv', (_req, res) => {
  const rows = Audit.list(10000);
  const header = ['timestamp', 'user', 'role', 'action', 'detail'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [header.join(','), ...rows.map(a => [a.ts, a.user, a.role, a.action, a.detail].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="scivox_audit_trail.csv"');
  res.send(csv);
});

export default r;
