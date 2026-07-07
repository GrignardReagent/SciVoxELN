import { Router } from 'express';
import { Audit, Projects, Users } from '../db.js';
import { requireRole } from '../auth.js';

const r = Router();

r.get('/', (req, res) => res.json(Projects.list(req.user)));

r.post('/', requireRole('admin'), (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const project = Projects.create({
    org_id: req.body?.org_id,
    name,
    slug: req.body?.slug,
    description: req.body?.description || ''
  });
  Projects.setMember(project.id, req.user.id, 'owner');
  Audit.log(req.user.name, req.user.role, 'CREATE_PROJECT', `${project.name} (${project.id})`, { projectId: project.id });
  res.status(201).json(project);
});

r.get('/:id/members', (req, res) => {
  if (!Projects.get(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, req.params.id, 'viewer')) return res.status(404).json({ error: 'Project not found' });
  res.json(Projects.members(req.params.id));
});

r.patch('/:id/members', (req, res) => {
  const project = Projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, req.params.id, 'owner')) return res.status(403).json({ error: 'Project owner access required' });

  const role = req.body?.role;
  const email = (req.body?.email || '').trim().toLowerCase();
  const userId = req.body?.userId || req.body?.user_id || null;
  const user = userId ? Users.getById(userId) : Users.getByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role == null || role === '' || role === 'remove') {
    Projects.removeMember(project.id, user.id);
    Audit.log(req.user.name, req.user.role, 'REMOVE_PROJECT_MEMBER', `${user.email || user.id} from "${project.name}"`, { projectId: project.id });
  } else {
    if (user.archived_at) return res.status(409).json({ error: 'Archived users must be restored before project membership can be changed' });
    try { Projects.setMember(project.id, user.id, role); }
    catch { return res.status(400).json({ error: 'Role must be viewer, scientist, reviewer or owner' }); }
    Audit.log(req.user.name, req.user.role, 'SET_PROJECT_MEMBER', `${user.email || user.id} -> ${role} in "${project.name}"`, { projectId: project.id });
  }
  res.json({ ok: true, members: Projects.members(project.id) });
});

export default r;
