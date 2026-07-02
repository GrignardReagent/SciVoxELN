import { Router } from 'express';
import { Experiments, Entries, Audit } from '../db.js';

const r = Router();

r.get('/', (_req, res) => res.json(Experiments.list()));

r.get('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(exp);
});

r.post('/', (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const exp = Experiments.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_EXPERIMENT', `"${exp.title}" (${exp.id})`);
  res.status(201).json(exp);
});

r.patch('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp.status === 'locked' && req.body.status !== 'active')
    return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const updated = Experiments.update(req.params.id, req.body);
  Audit.log(req.user.name, req.user.role, 'EDIT_EXPERIMENT', `"${updated.title}" (${updated.id})`);
  res.json(updated);
});

r.post('/:id/lock', (req, res) => {
  const exp = Experiments.get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  const updated = Experiments.update(req.params.id, { status: 'locked' });
  Audit.log(req.user.name, req.user.role, 'LOCK_EXPERIMENT', `"${updated.title}" (${updated.id})`);
  res.json(updated);
});

r.delete('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Cannot delete a locked experiment' });
  Experiments.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_EXPERIMENT', `"${exp.title}" (${exp.id})`);
  res.json({ ok: true });
});

/* Entries nested under an experiment */
r.post('/:id/entries', (req, res) => {
  const exp = Experiments.get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Entry text is required' });
  const entry = Entries.create(exp.id, {
    type: req.body.type, text, imageUrl: req.body.imageUrl || null,
    author: req.user.name, role: req.user.role
  });
  Audit.log(req.user.name, req.user.role, 'ADD_ENTRY', `${entry.type} entry in "${exp.title}"`);
  res.status(201).json(entry);
});

export default r;
