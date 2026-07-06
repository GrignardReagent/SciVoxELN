import { Router } from 'express';
import { Audit, Entries, ExperimentExports, Experiments, Projects, Refs, fingerprint } from '../db.js';

const r = Router();

r.get('/', (req, res) => res.json(Experiments.list(req.user)));

r.get('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(exp);
});

r.post('/', (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const projectId = req.body?.project_id || Projects.defaultProjectId();
  if (!Projects.get(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, projectId, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const exp = Experiments.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_EXPERIMENT', `"${exp.title}" (${exp.id})`, { projectId: exp.project_id });
  res.status(201).json(exp);
});

r.patch('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (req.body?.project_id) {
    if (!Projects.get(req.body.project_id)) return res.status(404).json({ error: 'Destination project not found' });
    if (!Projects.canAccessProject(req.user, req.body.project_id, 'scientist'))
      return res.status(403).json({ error: 'Destination project write access required' });
  }
  if (exp.status === 'locked' && req.body.status !== 'active')
    return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const updated = Experiments.update(req.params.id, req.body);
  Audit.log(req.user.name, req.user.role, 'EDIT_EXPERIMENT', `"${updated.title}" (${updated.id})`, { projectId: updated.project_id });
  res.json(updated);
});

r.post('/:id/lock', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'reviewer')) return res.status(403).json({ error: 'Project reviewer access required' });
  const updated = Experiments.update(req.params.id, { status: 'locked' });
  Audit.log(req.user.name, req.user.role, 'LOCK_EXPERIMENT', `"${updated.title}" (${updated.id})`, { projectId: updated.project_id });
  res.json(updated);
});

r.delete('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'owner')) return res.status(403).json({ error: 'Project owner access required' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Cannot delete a locked experiment' });
  Experiments.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_EXPERIMENT', `"${exp.title}" (${exp.id})`, { projectId: exp.project_id });
  res.json({ ok: true });
});

r.get('/:id/export', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  const refs = Refs.listByExperiment(exp.id);
  const audit = Audit.list({ project: exp.project_id, limit: 10000 });
  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    exported_by: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
    experiment: exp,
    references: refs,
    audit,
    integrity: {}
  };
  payload.integrity.sha256 = fingerprint(JSON.stringify({ ...payload, integrity: {} }));
  ExperimentExports.record(exp.id, { createdBy: req.user.name, format: req.query.format === 'html' ? 'html' : 'json', hash: payload.integrity.sha256 });
  Audit.log(req.user.name, req.user.role, 'EXPORT_EXPERIMENT', `"${exp.title}" sha256 ${payload.integrity.sha256}`, { projectId: exp.project_id });

  if (req.query.format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-export.html"`);
    return res.send(exportHtml(payload));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-export.json"`);
  res.json(payload);
});

/* Entries nested under an experiment */
r.post('/:id/entries', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Entry text is required' });
  const entry = Entries.create(exp.id, {
    type: req.body.type, text, imageUrl: req.body.imageUrl || null,
    rawImageUrl: req.body.rawImageUrl || null,
    cleanImageUrl: req.body.cleanImageUrl || null,
    author: req.user.name, role: req.user.role
  });
  if (entry.type === 'observe') {
    Audit.log(req.user.name, req.user.role, 'ADD_OBSERVE_ENTRY',
      `confirmed observe run in "${exp.title}" (entry ${entry.id})\n${auditText(text)}`, { projectId: exp.project_id });
  } else if (entry.type === 'figure') {
    Audit.log(req.user.name, req.user.role, 'ADD_FIGURE_ENTRY',
      `attached figure to "${exp.title}" (entry ${entry.id}) | raw ${entry.raw_image_url || 'none'} | clean ${entry.clean_image_url || entry.image_url || 'none'}`,
      { projectId: exp.project_id });
  } else {
    Audit.log(req.user.name, req.user.role, 'ADD_ENTRY', `${entry.type} entry in "${exp.title}"`, { projectId: exp.project_id });
  }
  res.status(201).json(entry);
});

export default r;

function auditText(text, max = 3000) {
  const clean = String(text || '').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function safeName(name) {
  return String(name || 'experiment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'experiment';
}

function exportHtml(pkg) {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const exp = pkg.experiment;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(exp.title)} export</title>
  <style>body{font-family:system-ui,sans-serif;max-width:980px;margin:32px auto;padding:0 20px;line-height:1.45} pre{white-space:pre-wrap} .muted{color:#667085}.entry{border-top:1px solid #ddd;padding:14px 0}.hash{font-family:ui-monospace,monospace;font-size:12px}</style></head>
  <body><h1>${esc(exp.title)}</h1><p class="muted">${esc(exp.project_name || exp.project || 'General')} · ${esc(exp.status)}</p>
  <h2>Objective</h2><p>${esc(exp.objective || '')}</p>
  <h2>Notebook Entries</h2>${(exp.entries || []).map(en => `<div class="entry"><b>${esc(en.type)}</b> · ${esc(en.created_at)} · ${esc(en.author || '')}<pre>${esc(en.text)}</pre><div class="hash">hash ${esc(en.hash)}${en.sig ? ` · sig ${esc(en.sig)}` : ''}</div></div>`).join('') || '<p>No entries.</p>'}
  <h2>References</h2><ul>${(pkg.references || []).map(r => `<li>${esc(r.title)} ${r.year ? `(${esc(r.year)})` : ''}</li>`).join('') || '<li>None</li>'}</ul>
  <h2>Integrity</h2><p class="hash">Export SHA-256: ${esc(pkg.integrity.sha256)}</p>
  <p class="muted">Exported ${esc(pkg.exported_at)} by ${esc(pkg.exported_by.name || pkg.exported_by.email)}.</p></body></html>`;
}
