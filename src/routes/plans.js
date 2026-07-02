import { Router } from 'express';
import { Plans, Experiments, Audit } from '../db.js';

const r = Router();

r.get('/', (_req, res) => res.json(Plans.list()));

r.get('/:id', (req, res) => {
  const p = Plans.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  res.json(p);
});

r.post('/', (req, res) => {
  if (!req.body || !req.body.title) return res.status(400).json({ error: 'Title is required' });
  const p = Plans.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_PLAN', `"${p.title}" (${p.id})`);
  res.status(201).json(p);
});

r.patch('/:id', (req, res) => {
  const p = Plans.update(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  Audit.log(req.user.name, req.user.role, 'EDIT_PLAN', `"${p.title}" (${p.id})`);
  res.json(p);
});

r.delete('/:id', (req, res) => {
  const p = Plans.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  Plans.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_PLAN', `"${p.title}" (${p.id})`);
  res.json({ ok: true });
});

/** Turn a plan into a running experiment; seeds a first entry from the plan. */
r.post('/:id/start', (req, res) => {
  const p = Plans.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  let exp;
  if (p.experiment_id && Experiments.get(p.experiment_id)) {
    exp = Experiments.get(p.experiment_id);
  } else {
    exp = Experiments.create({
      title: p.title,
      project: req.body?.project || 'Planned',
      objective: p.hypothesis || p.expected_outcome || ''
    });
    Plans.update(p.id, { experiment_id: exp.id, status: 'started' });
    Audit.log(req.user.name, req.user.role, 'CREATE_EXPERIMENT', `from plan "${p.title}" (${exp.id})`);
  }
  Plans.update(p.id, { status: 'started' });
  Audit.log(req.user.name, req.user.role, 'START_PLAN', `"${p.title}" → experiment ${exp.id}`);
  res.json({ plan: Plans.get(p.id), experiment: exp });
});

export default r;
