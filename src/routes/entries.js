import { Router } from 'express';
import { Entries, Experiments, Audit } from '../db.js';

const r = Router();

r.get('/:id', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  res.json(en);
});

/** Apply an electronic signature — locks the entry immutably. */
r.post('/:id/sign', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  if (!req.user.name || req.user.name === 'Unknown')
    return res.status(400).json({ error: 'Set your identity before signing' });
  if (en.signed_by) return res.status(409).json({ error: 'Entry is already signed' });
  const signed = Entries.sign(req.params.id, { by: req.user.name, role: req.user.role });
  const exp = Experiments.get(en.experiment_id);
  Audit.log(req.user.name, req.user.role, 'SIGN_ENTRY', `entry in "${exp ? exp.title : en.experiment_id}" — sig ${signed.sig}`);
  res.json(signed);
});

export default r;
