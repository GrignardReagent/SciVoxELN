import { Router } from 'express';
import { Audit, Experiments, Plans, Projects } from '../db.js';

const r = Router();

r.get('/', (req, res) => res.json(Plans.list(req.user)));

r.get('/:id', (req, res) => {
  const p = Plans.get(req.params.id, req.user);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  res.json(p);
});

r.post('/', (req, res) => {
  if (!req.body || !req.body.title) return res.status(400).json({ error: 'Title is required' });
  const projectId = req.body.project_id || Projects.defaultProjectId();
  if (!Projects.get(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, projectId, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const p = Plans.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_PLAN', `"${p.title}" (${p.id})`, { projectId: p.project_id });
  res.status(201).json(p);
});

r.patch('/:id', (req, res) => {
  const existing = Plans.get(req.params.id, req.user);
  if (!existing) return res.status(404).json({ error: 'Plan not found' });
  if (!Projects.canAccessProject(req.user, existing.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (req.body?.project_id) {
    if (!Projects.get(req.body.project_id)) return res.status(404).json({ error: 'Destination project not found' });
    if (!Projects.canAccessProject(req.user, req.body.project_id, 'scientist'))
      return res.status(403).json({ error: 'Destination project write access required' });
  }
  const p = Plans.update(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  Audit.log(req.user.name, req.user.role, 'EDIT_PLAN', `"${p.title}" (${p.id})`, { projectId: p.project_id });
  res.json(p);
});

r.delete('/:id', (req, res) => {
  const p = Plans.get(req.params.id, req.user);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  if (!Projects.canAccessProject(req.user, p.project_id, 'owner')) return res.status(403).json({ error: 'Project owner access required' });
  Plans.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_PLAN', `"${p.title}" (${p.id})`, { projectId: p.project_id });
  res.json({ ok: true });
});

/** Turn a plan into a running experiment; seeds a first entry from the plan. */
r.post('/:id/start', (req, res) => {
  const p = Plans.get(req.params.id, req.user);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  if (!Projects.canAccessProject(req.user, p.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  let exp;
  if (p.experiment_id && Experiments.get(p.experiment_id, req.user)) {
    exp = Experiments.get(p.experiment_id, req.user);
  } else {
    exp = Experiments.create({
      title: p.title,
      project_id: p.project_id,
      project: req.body?.project || 'Planned',
      objective: p.hypothesis || p.expected_outcome || ''
    });
    Plans.update(p.id, { experiment_id: exp.id, status: 'started' });
    Audit.log(req.user.name, req.user.role, 'CREATE_EXPERIMENT', `from plan "${p.title}" (${exp.id})`, { projectId: exp.project_id });
  }
  Plans.update(p.id, { status: 'started' });
  Audit.log(req.user.name, req.user.role, 'START_PLAN', `"${p.title}" → experiment ${exp.id}`, { projectId: exp.project_id });
  res.json({ plan: Plans.get(p.id), experiment: exp });
});

export default r;
