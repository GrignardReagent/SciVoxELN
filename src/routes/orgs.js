import { Router } from 'express';
import { Audit, Orgs } from '../db.js';
import { requireRole } from '../auth.js';

const r = Router();

r.get('/', (req, res) => res.json(Orgs.list(req.user)));

r.post('/', requireRole('admin'), (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Organisation name is required' });
  const org = Orgs.create({ name, slug: req.body?.slug });
  Audit.log(req.user.name, req.user.role, 'CREATE_ORG', `${org.name} (${org.id})`);
  res.status(201).json(org);
});

export default r;
