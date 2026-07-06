import { Router } from 'express';
import { Audit, Projects } from '../db.js';

const r = Router();

r.get('/', (req, res) => {
  res.json(Audit.list(filters(req)));
});

/** Export the full audit trail as CSV. */
r.get('/export.csv', (req, res) => {
  const rows = Audit.list({ ...filters(req), limit: 10000 });
  const header = ['timestamp', 'user', 'role', 'action', 'project_id', 'detail', 'previous_hash', 'hash'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [header.join(','), ...rows.map(a => [a.ts, a.user, a.role, a.action, a.project_id, a.detail, a.previous_hash, a.hash].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="scivox_audit_trail.csv"');
  res.send(csv);
});

export default r;

function filters(req) {
  const out = {
    limit: Math.min(Number(req.query.limit) || 1000, 10000),
    project: req.query.project || '',
    user: req.query.user || '',
    action: req.query.action || '',
    from: req.query.from || '',
    to: req.query.to || ''
  };
  if (req.user.role !== 'admin') {
    out.projectIds = Projects.idsForUser(req.user);
  }
  return out;
}
