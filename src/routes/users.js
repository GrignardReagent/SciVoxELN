import { Router } from 'express';
import { Users, Audit } from '../db.js';
import { requireRole, ROLES } from '../auth.js';

const r = Router();

// Everything here is admin-only.
r.use(requireRole('admin'));

r.get('/', (_req, res) => res.json(Users.list()));

r.patch('/:id/role', (req, res) => {
  const role = req.body?.role;
  if (!ROLES[role]) return res.status(400).json({ error: 'Role must be viewer, scientist, reviewer or admin' });
  const target = Users.getById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  // Don't allow removing the last admin.
  if (target.role === 'admin' && role !== 'admin' && Users.countAdmins() <= 1)
    return res.status(409).json({ error: 'Cannot demote the last remaining admin' });
  const updated = Users.setRole(req.params.id, role);
  Audit.log(req.user.name, req.user.role, 'SET_ROLE', `${target.email || target.id} → ${role}`);
  res.json(updated);
});

export default r;
