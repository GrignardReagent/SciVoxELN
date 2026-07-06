import { Router } from 'express';
import { Audit, Experiments, FigureTemplates, Projects } from '../db.js';

const r = Router();
const MAX_TEMPLATE_BYTES = 1_800_000;

r.get('/', (req, res) => {
  const ctx = resolveProject(req, res, 'viewer'); if (!ctx) return;
  res.json(FigureTemplates.listByProject(ctx.projectId));
});

r.post('/', (req, res) => {
  const ctx = resolveProject(req, res, 'scientist'); if (!ctx) return;
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Template name is required' });
  const template = req.body?.template;
  if (!template || typeof template !== 'object' || Array.isArray(template))
    return res.status(400).json({ error: 'Template payload is required' });
  const size = Buffer.byteLength(JSON.stringify(template), 'utf8');
  if (size > MAX_TEMPLATE_BYTES) return res.status(413).json({ error: 'Template is too large' });

  const saved = FigureTemplates.create({
    project_id: ctx.projectId,
    name,
    template,
    created_by: req.user.name,
    created_by_user_id: req.user.id
  });
  Audit.log(req.user.name, req.user.role, 'CREATE_FIGURE_TEMPLATE',
    `"${saved.name}" (${saved.id})`, { projectId: ctx.projectId });
  res.status(201).json(saved);
});

r.delete('/:id', (req, res) => {
  const tpl = FigureTemplates.get(req.params.id);
  if (!tpl || !Projects.canAccessProject(req.user, tpl.project_id, 'viewer'))
    return res.status(404).json({ error: 'Template not found' });
  const canDelete = req.user.role === 'admin'
    || tpl.created_by_user_id === req.user.id
    || Projects.canAccessProject(req.user, tpl.project_id, 'owner');
  if (!canDelete) return res.status(403).json({ error: 'Template owner access required' });
  FigureTemplates.remove(tpl.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_FIGURE_TEMPLATE',
    `"${tpl.name}" (${tpl.id})`, { projectId: tpl.project_id });
  res.json({ ok: true });
});

export default r;

function resolveProject(req, res, minRole = 'viewer') {
  const experimentId = req.body?.experimentId || req.query.experimentId;
  if (experimentId) {
    const exp = Experiments.get(experimentId, req.user);
    if (!exp) { res.status(404).json({ error: 'Experiment not found' }); return null; }
    if (!Projects.canAccessProject(req.user, exp.project_id, minRole)) {
      res.status(403).json({ error: 'Project access required' }); return null;
    }
    return { projectId: exp.project_id, experiment: exp };
  }

  const projectId = req.body?.projectId || req.body?.project_id || req.query.projectId || req.query.project_id;
  if (!projectId || !Projects.get(projectId)) {
    res.status(400).json({ error: 'experimentId or projectId is required' }); return null;
  }
  if (!Projects.canAccessProject(req.user, projectId, minRole)) {
    res.status(403).json({ error: 'Project access required' }); return null;
  }
  return { projectId };
}
