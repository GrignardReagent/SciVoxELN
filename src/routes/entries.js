import { Router } from 'express';
import { Audit, Entries, Experiments, Projects, Users } from '../db.js';
import { requireRole, verifyPassword } from '../auth.js';

const r = Router();

r.get('/:id', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  const exp = Experiments.get(en.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Entry not found' });
  res.json(en);
});

/** Apply an electronic signature — locks the entry immutably. */
r.post('/:id/sign', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  const exp = Experiments.get(en.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Entry not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project signer access required' });
  if (!req.user.name || req.user.name === 'Unknown')
    return res.status(400).json({ error: 'Set your identity before signing' });
  if (en.signed_by) return res.status(409).json({ error: 'Entry is already signed' });
  const user = Users.getById(req.user.id);
  if (user?.password_hash && !verifyPassword(req.body?.password || '', user.password_hash))
    return res.status(401).json({ error: 'Password confirmation is required to sign' });
  if (!user?.password_hash && req.body?.attestation !== 'I am signing this record')
    return res.status(400).json({ error: 'Signature attestation is required for this account' });
  const meaning = ['author', 'reviewer', 'approval'].includes(req.body?.meaning) ? req.body.meaning : 'author';
  const signed = Entries.sign(req.params.id, { by: req.user.name, role: req.user.role, meaning });
  Audit.log(req.user.name, req.user.role, 'SIGN_ENTRY', `${meaning} signature in "${exp.title}" — sig ${signed.sig}`, { projectId: exp.project_id });
  res.json(signed);
});

/** Admin-only removal. The audit trail keeps deletion context. */
r.delete('/:id', requireRole('admin'), (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  const exp = Experiments.get(en.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Entry not found' });
  const reason = (req.body?.reason || '').trim();
  const removed = Entries.remove(req.params.id, { by: req.user.name, reason });
  Audit.log(req.user.name, req.user.role, 'DELETE_ENTRY',
    [
      `admin tombstoned ${removed.type} entry ${removed.id} from "${exp.title}"`,
      `hash ${removed.hash}`,
      removed.signed_by ? `signed by ${removed.signed_by} at ${removed.signed_at}` : 'unsigned',
      reason ? `reason: ${reason}` : 'no reason provided',
      `excerpt: ${auditExcerpt(removed.text)}`
    ].join(' | '), { projectId: exp.project_id });
  res.json({ ok: true });
});

export default r;

function auditExcerpt(text, max = 360) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}
