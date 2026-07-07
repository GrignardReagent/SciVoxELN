import { Router } from 'express';
import { Users, Audit } from '../db.js';
import { requireRole, revokeUserSessions, ROLES } from '../auth.js';

const r = Router();

// Everything here is admin-only.
r.use(requireRole('admin'));

r.get('/', (req, res) => res.json(Users.list({ includeArchived: req.query.includeArchived === 'true' })));

r.patch('/:id/role', (req, res) => {
  const role = req.body?.role;
  if (!ROLES[role]) return res.status(400).json({ error: 'Role must be viewer, scientist, reviewer or admin' });
  const target = Users.getById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.archived_at) return res.status(409).json({ error: 'Archived users must be restored before changing role' });
  // Don't allow removing the last admin.
  if (target.role === 'admin' && role !== 'admin' && Users.countAdmins() <= 1)
    return res.status(409).json({ error: 'Cannot demote the last remaining admin' });
  const updated = Users.setRole(req.params.id, role);
  Audit.log(req.user.name, req.user.role, 'SET_ROLE', `${target.email || target.id} → ${role}`);
  res.json(updated);
});

r.post('/:id/archive', (req, res) => {
  const target = Users.getById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(409).json({ error: 'Cannot archive your own account' });
  if (target.archived_at) return res.json(Users.public(target));
  if (target.role === 'admin' && Users.countAdmins() <= 1)
    return res.status(409).json({ error: 'Cannot archive the last remaining admin' });

  const updated = Users.archive(target.id, req.user.id);
  const revoked = revokeUserSessions(target.id);
  Audit.log(req.user.name, req.user.role, 'ARCHIVE_USER', `${target.email || target.id} archived; sessions revoked: ${revoked}`);
  res.json(updated);
});

r.post('/:id/restore', (req, res) => {
  const target = Users.getById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.archived_at) return res.json(Users.public(target));

  const updated = Users.restore(target.id);
  Audit.log(req.user.name, req.user.role, 'RESTORE_USER', `${target.email || target.id} restored`);
  res.json(updated);
});

export default r;
