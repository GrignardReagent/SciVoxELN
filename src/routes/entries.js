import { Router } from 'express';
import { Audit, Entries, EntryComments, Experiments, Projects, Users, isHiddenEntryType } from '../db.js';
import { requireRole, verifyPassword } from '../auth.js';

const r = Router();

r.get('/', (req, res) => {
  res.json(Entries.list(req.user));
});

r.get('/:id', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  const exp = Experiments.get(en.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Entry not found' });
  res.json(en);
});

r.patch('/:id', (req, res) => {
  const en = Entries.get(req.params.id);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  const exp = Experiments.get(en.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Entry not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  if (en.signed_by) return res.status(409).json({ error: 'Signed entries cannot be edited' });
  if (en.type === 'voice_transcript') return res.status(409).json({ error: 'Voice source transcripts cannot be edited' });
  if (en.type === 'ocr_raw_text') return res.status(409).json({ error: 'Raw OCR source text cannot be edited' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Entry text is required' });
  const updated = Entries.update(req.params.id, { text });
  Audit.log(req.user.name, req.user.role, 'EDIT_ENTRY',
    `${updated.type} entry ${updated.id} edited in "${exp.title}" | old hash ${en.hash} | new hash ${updated.hash} | excerpt: ${auditExcerpt(updated.text)}`,
    { projectId: exp.project_id });
  res.json(updated);
});

r.post('/:id/comments', (req, res) => {
  const en = Entries.getDetailed(req.params.id, req.user);
  if (!en) return res.status(404).json({ error: 'Entry not found' });
  if (isHiddenEntryType(en.type)) return res.status(409).json({ error: 'Hidden source entries cannot be commented on' });
  if (!Projects.canAccessProject(req.user, en.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (en.experiment_status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });
  const comment = EntryComments.create(req.params.id, {
    userId: req.user.id,
    author: req.user.name,
    role: req.user.role,
    text
  });
  Audit.log(req.user.name, req.user.role, 'ADD_ENTRY_COMMENT',
    `comment ${comment.id} on ${en.type} entry ${en.id} in "${en.experiment_title}" | excerpt: ${auditExcerpt(comment.text)}`,
    { projectId: en.project_id });
  res.status(201).json(comment);
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
  if (['reviewer', 'approval'].includes(meaning) && !Projects.canAccessProject(req.user, exp.project_id, 'reviewer')) {
    return res.status(403).json({ error: 'Project reviewer access required for reviewer or approval signatures' });
  }
  const signed = Entries.sign(req.params.id, { by: req.user.name, role: req.user.role, meaning });
  Audit.log(req.user.name, req.user.role, 'SIGN_ENTRY', `${meaning} signature in "${exp.title}" — sig ${signed.sig}`, { projectId: exp.project_id });
  res.json(signed);
});

/** Admin-only removal. The audit trail keeps deletion context. */
r.delete('/batch', requireRole('admin'), (req, res) => {
  const ids = Array.from(new Set((req.body?.entryIds || []).map(String).filter(Boolean))).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: 'entryIds[] required' });
  let deleted = 0;
  const missing = [];
  for (const entryId of ids) {
    const en = Entries.get(entryId);
    if (!en) { missing.push(entryId); continue; }
    const exp = Experiments.get(en.experiment_id, req.user);
    if (!exp) { missing.push(entryId); continue; }
    const removed = Entries.remove(entryId, { by: req.user.name, reason: 'batch delete from Entries Library' });
    if (removed?.deleted_at) {
      deleted += 1;
      Audit.log(req.user.name, req.user.role, 'DELETE_ENTRY',
        [
          `admin batch tombstoned ${removed.type} entry ${removed.id} from "${exp.title}"`,
          `hash ${removed.hash}`,
          removed.signed_by ? `signed by ${removed.signed_by} at ${removed.signed_at}` : 'unsigned',
          `excerpt: ${auditExcerpt(removed.text)}`
        ].join(' | '), { projectId: exp.project_id });
    }
  }
  res.json({ deleted, missing });
});

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
