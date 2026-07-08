import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Audit, Entries, ExperimentAttachments, ExperimentExports, ExperimentLinks, ExperimentSteps, Experiments, ExperimentTemplates, Projects, Refs, fingerprint, isHiddenEntryType } from '../db.js';
import { requireRole } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ATTACHMENT_DIR = path.join(UPLOAD_DIR, 'attachments');
fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(ATTACHMENT_DIR, safeFolder(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName(file.originalname || 'attachment')}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const r = Router();

r.get('/', (req, res) => res.json(Experiments.list(req.user, { includeArchived: req.query.includeArchived === 'true' })));

r.get('/templates', (req, res) => {
  res.json(ExperimentTemplates.list(req.user, { projectId: req.query.projectId || '' }));
});

r.get('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(publicExperiment(exp));
});

r.post('/', (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const projectId = req.body?.project_id || Projects.defaultProjectId();
  if (!Projects.get(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, projectId, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const template = req.body?.template_id ? ExperimentTemplates.get(req.body.template_id, req.user) : null;
  if (req.body?.template_id && !template) return res.status(404).json({ error: 'Experiment template not found' });
  if (template && template.project_id !== projectId) return res.status(400).json({ error: 'Experiment template belongs to a different project' });
  const payload = template ? applyTemplateDefaults(req.body, template) : req.body;
  let exp;
  try {
    exp = Experiments.create(payload);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid experiment data' });
  }
  Audit.log(
    req.user.name,
    req.user.role,
    'CREATE_EXPERIMENT',
    template ? `"${exp.title}" (${exp.id}) from template "${template.name}" (${template.id})` : `"${exp.title}" (${exp.id})`,
    { projectId: exp.project_id }
  );
  res.status(201).json(Experiments.get(exp.id, req.user) || exp);
});

r.post('/:id/template', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  const name = String(req.body?.name || '').trim() || `${exp.title} template`;
  const description = String(req.body?.description || '').trim();
  const template = ExperimentTemplates.createFromExperiment(exp, { name, description, createdBy: req.user.name });
  Audit.log(
    req.user.name,
    req.user.role,
    'CREATE_EXPERIMENT_TEMPLATE',
    `created template "${template.name}" (${template.id}) from "${exp.title}" (${exp.id})`,
    { projectId: exp.project_id }
  );
  res.status(201).json(template);
});

r.post('/:id/duplicate', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (archivedReadOnly(exp, res)) return;
  const projectId = String(req.body?.project_id || exp.project_id || '').trim();
  if (!Projects.get(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (!Projects.canAccessProject(req.user, projectId, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const result = Experiments.duplicateSetup(exp.id, {
    title: String(req.body?.title || '').trim(),
    projectId,
    createdBy: req.user.name
  });
  if (!result?.experiment) return res.status(404).json({ error: 'Experiment not found' });
  Audit.log(
    req.user.name,
    req.user.role,
    'DUPLICATE_EXPERIMENT',
    `duplicated setup from "${exp.title}" (${exp.id}) as "${result.experiment.title}" (${result.experiment.id}) | steps copied: ${result.stepsCopied}`,
    { projectId: result.experiment.project_id }
  );
  res.status(201).json(publicExperiment(Experiments.get(result.experiment.id, req.user) || result.experiment));
});

r.post('/:id/archive', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const archived = Experiments.archive(exp.id, { by: req.user.name });
  Audit.log(req.user.name, req.user.role, 'ARCHIVE_EXPERIMENT', `"${archived.title}" (${archived.id})`, { projectId: archived.project_id });
  res.json(publicExperiment(archived));
});

r.post('/:id/restore', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  const restored = Experiments.restore(exp.id);
  Audit.log(req.user.name, req.user.role, 'RESTORE_EXPERIMENT', `"${restored.title}" (${restored.id})`, { projectId: restored.project_id });
  res.json(publicExperiment(restored));
});

r.get('/:id/links', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(ExperimentLinks.list(exp.id, req.user));
});

r.post('/:id/links', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });

  const linkedExperimentId = String(req.body?.linkedExperimentId || req.body?.linked_experiment_id || '').trim();
  if (!linkedExperimentId) return res.status(400).json({ error: 'Linked experiment is required' });
  if (linkedExperimentId === exp.id) return res.status(400).json({ error: 'Cannot link an experiment to itself' });

  const target = Experiments.get(linkedExperimentId, req.user);
  if (!target) return res.status(404).json({ error: 'Linked experiment not found' });
  try {
    const link = ExperimentLinks.create(exp.id, {
      linkedExperimentId: target.id,
      note: String(req.body?.note || '').trim(),
      createdBy: req.user.name
    });
    Audit.log(
      req.user.name,
      req.user.role,
      'ADD_EXPERIMENT_LINK',
      `linked "${exp.title}" (${exp.id}) to "${target.title}" (${target.id}) as ${link.id}${link.note ? ` | note: ${link.note}` : ''}`,
      { projectId: exp.project_id }
    );
    res.status(201).json(link);
  } catch (err) {
    if (/constraint|unique/i.test(String(err?.message || err))) {
      return res.status(409).json({ error: 'Experiment link already exists' });
    }
    throw err;
  }
});

r.delete('/:id/links/:linkId', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });

  const link = ExperimentLinks.get(req.params.linkId, req.user);
  if (!link || link.experiment_id !== exp.id) return res.status(404).json({ error: 'Experiment link not found' });
  ExperimentLinks.remove(exp.id, link.id);
  Audit.log(
    req.user.name,
    req.user.role,
    'REMOVE_EXPERIMENT_LINK',
    `removed link ${link.id} from "${exp.title}" (${exp.id}) to "${link.linked_title}" (${link.linked_experiment_id})`,
    { projectId: exp.project_id }
  );
  res.json({ ok: true });
});

r.get('/:id/steps', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(ExperimentSteps.list(exp.id));
});

r.post('/:id/steps', requireExperimentWrite, (req, res) => {
  const exp = req.experiment;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Step text is required' });
  const step = ExperimentSteps.create(exp.id, { text, createdBy: req.user.name });
  Audit.log(
    req.user.name,
    req.user.role,
    'ADD_EXPERIMENT_STEP',
    `added step ${step.id} to "${exp.title}" (${exp.id}) | ${step.text}`,
    { projectId: exp.project_id }
  );
  res.status(201).json(step);
});

r.patch('/:id/steps/:stepId', requireExperimentWrite, (req, res) => {
  const exp = req.experiment;
  const existing = ExperimentSteps.get(req.params.stepId);
  if (!existing || existing.experiment_id !== exp.id || existing.deleted_at) return res.status(404).json({ error: 'Experiment step not found' });
  const hasText = req.body && Object.prototype.hasOwnProperty.call(req.body, 'text');
  const hasDone = req.body && Object.prototype.hasOwnProperty.call(req.body, 'done');
  if (!hasText && !hasDone) return res.status(400).json({ error: 'No step updates provided' });
  try {
    const step = ExperimentSteps.update(exp.id, existing.id, {
      text: hasText ? req.body.text : undefined,
      done: hasDone ? !!req.body.done : undefined,
      completedBy: req.user.name
    });
    const changes = [
      hasText ? 'text' : '',
      hasDone ? `done=${step.done ? 'true' : 'false'}` : ''
    ].filter(Boolean).join(', ');
    Audit.log(
      req.user.name,
      req.user.role,
      'UPDATE_EXPERIMENT_STEP',
      `updated step ${step.id} in "${exp.title}" (${exp.id}) | ${changes}`,
      { projectId: exp.project_id }
    );
    res.json(step);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid step update' });
  }
});

r.delete('/:id/steps/:stepId', requireExperimentWrite, (req, res) => {
  const exp = req.experiment;
  const existing = ExperimentSteps.get(req.params.stepId);
  if (!existing || existing.experiment_id !== exp.id || existing.deleted_at) return res.status(404).json({ error: 'Experiment step not found' });
  const step = ExperimentSteps.remove(exp.id, existing.id, { deletedBy: req.user.name });
  Audit.log(
    req.user.name,
    req.user.role,
    'REMOVE_EXPERIMENT_STEP',
    `removed step ${existing.id} from "${exp.title}" (${exp.id}) | ${existing.text}`,
    { projectId: exp.project_id }
  );
  res.json(step);
});

r.get('/:id/attachments', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  res.json(ExperimentAttachments.list(exp.id));
});

r.post('/:id/attachments', requireExperimentWrite, attachmentUpload.single('file'), (req, res) => {
  const exp = req.experiment;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const relativeFolder = `attachments/${safeFolder(exp.id)}`;
  const url = `/uploads/${relativeFolder}/${req.file.filename}`;
  const attachment = ExperimentAttachments.create(exp.id, {
    originalName: req.file.originalname || req.file.filename,
    storedName: req.file.filename,
    mimeType: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    url,
    hash: fileSha256(req.file.path),
    note: String(req.body?.note || '').trim(),
    uploadedBy: req.user.name
  });
  Audit.log(
    req.user.name,
    req.user.role,
    'ADD_EXPERIMENT_ATTACHMENT',
    `attached file ${attachment.id} "${attachment.original_name}" to "${exp.title}" (${exp.id}) | ${attachment.size} bytes | sha256 ${attachment.hash}${attachment.note ? ` | note: ${attachment.note}` : ''}`,
    { projectId: exp.project_id }
  );
  res.status(201).json(attachment);
});

r.delete('/:id/attachments/:attachmentId', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const attachment = ExperimentAttachments.get(req.params.attachmentId);
  if (!attachment || attachment.experiment_id !== exp.id || attachment.deleted_at) return res.status(404).json({ error: 'Attachment not found' });
  const removed = ExperimentAttachments.remove(exp.id, attachment.id, { deletedBy: req.user.name });
  Audit.log(
    req.user.name,
    req.user.role,
    'REMOVE_EXPERIMENT_ATTACHMENT',
    `removed attachment ${attachment.id} "${attachment.original_name}" from "${exp.title}" (${exp.id}) | sha256 ${attachment.hash}`,
    { projectId: exp.project_id }
  );
  res.json(removed);
});

r.patch('/:id', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (req.body?.project_id) {
    if (!Projects.get(req.body.project_id)) return res.status(404).json({ error: 'Destination project not found' });
    if (!Projects.canAccessProject(req.user, req.body.project_id, 'scientist'))
      return res.status(403).json({ error: 'Destination project write access required' });
  }
  if (exp.status === 'locked')
    return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  let updated;
  try {
    updated = Experiments.update(req.params.id, req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid experiment data' });
  }
  Audit.log(req.user.name, req.user.role, 'EDIT_EXPERIMENT', `"${updated.title}" (${updated.id})`, { projectId: updated.project_id });
  res.json(Experiments.get(updated.id, req.user) || updated);
});

r.post('/:id/lock', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'reviewer')) return res.status(403).json({ error: 'Project reviewer access required' });
  if (archivedReadOnly(exp, res)) return;
  const updated = Experiments.update(req.params.id, { status: 'locked' });
  Audit.log(req.user.name, req.user.role, 'LOCK_EXPERIMENT', `"${updated.title}" (${updated.id})`, { projectId: updated.project_id });
  res.json(Experiments.get(updated.id, req.user) || updated);
});

r.delete('/:id', requireRole('admin'), (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Cannot delete a locked experiment' });
  const reason = String(req.body?.reason || '').trim();
  const entries = exp.entries || [];
  const entryHashes = entries.map(en => en.hash).filter(Boolean);
  Experiments.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_EXPERIMENT',
    [
      `admin deleted experiment "${exp.title}" (${exp.id})`,
      `project ${exp.project_name || exp.project || exp.project_id || 'unknown'}`,
      `status ${exp.status}`,
      `entries deleted: ${entries.length}`,
      entryHashes.length ? `entry hashes: ${entryHashes.join(', ')}` : 'entry hashes: none',
      reason ? `reason: ${reason}` : 'no reason provided'
    ].join(' | '), { projectId: exp.project_id });
  res.json({ ok: true });
});

r.get('/:id/export', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  const format = ['html', 'pdf', 'rocrate', 'zip'].includes(req.query.format) ? req.query.format : 'json';
  const refs = Refs.listByExperiment(exp.id);
  const links = ExperimentLinks.list(exp.id, req.user);
  const attachments = ExperimentAttachments.list(exp.id);
  const steps = ExperimentSteps.list(exp.id);
  const audit = Audit.list({ project: exp.project_id, limit: 10000 });
  const revisionsByEntry = Entries.revisionsForExperiment(exp.id);
  const exportExperiment = {
    ...exp,
    entries: (exp.entries || []).map(en => ({ ...en, revisions: revisionsByEntry[en.id] || [] }))
  };
  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    exported_by: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
    experiment: exportExperiment,
    experiment_links: links,
    steps,
    attachments,
    references: refs,
    audit,
    integrity: {}
  };
  payload.integrity.sha256 = fingerprint(JSON.stringify({ ...payload, integrity: {} }));
  ExperimentExports.record(exp.id, { createdBy: req.user.name, format, hash: payload.integrity.sha256 });
  Audit.log(req.user.name, req.user.role, 'EXPORT_EXPERIMENT', `"${exp.title}" sha256 ${payload.integrity.sha256}`, { projectId: exp.project_id });

  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-export.html"`);
    return res.send(exportHtml(payload));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-export.pdf"`);
    return res.send(exportPdf(payload));
  }
  if (format === 'rocrate') {
    res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-ro-crate-metadata.json"`);
    return res.json(exportRoCrate(payload));
  }
  if (format === 'zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-evidence-bundle.zip"`);
    return res.send(exportZipBundle(payload));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(exp.title)}-export.json"`);
  res.json(payload);
});

/* Entries nested under an experiment */
r.post('/:id/entries', (req, res) => {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Entry text is required' });
  const sourceEntryIds = Array.from(new Set((req.body?.sourceEntryIds || []).map(String).filter(Boolean))).slice(0, 40);
  if (sourceEntryIds.length) {
    const sources = Entries.getManyDetailed(sourceEntryIds, req.user);
    if (sources.length !== sourceEntryIds.length || sources.some(s => s.experiment_id !== exp.id))
      return res.status(400).json({ error: 'Source entries must belong to this experiment' });
  }
  const entry = Entries.create(exp.id, {
    type: req.body.type, text, imageUrl: req.body.imageUrl || null,
    rawImageUrl: req.body.rawImageUrl || null,
    cleanImageUrl: req.body.cleanImageUrl || null,
    author: req.user.name, role: req.user.role, sourceEntryIds
  });
  if (entry.type === 'observe') {
    Audit.log(req.user.name, req.user.role, 'ADD_OBSERVE_ENTRY',
      `confirmed observe run in "${exp.title}" (entry ${entry.id})\n${auditText(text)}`, { projectId: exp.project_id });
  } else if (entry.type === 'figure') {
    Audit.log(req.user.name, req.user.role, 'ADD_FIGURE_ENTRY',
      `attached figure to "${exp.title}" (entry ${entry.id}) | raw ${entry.raw_image_url || 'none'} | clean ${entry.clean_image_url || entry.image_url || 'none'}`,
      { projectId: exp.project_id });
  } else if (entry.type === 'ocr') {
    Audit.log(req.user.name, req.user.role, 'ADD_OCR_ENTRY',
      `captured OCR scan in "${exp.title}" (entry ${entry.id}) | raw ${entry.raw_image_url || 'none'} | processed ${entry.clean_image_url || entry.image_url || 'none'} | hash ${entry.hash}`,
      { projectId: exp.project_id });
  } else if (entry.type === 'voice_transcript') {
    Audit.log(req.user.name, req.user.role, 'ADD_VOICE_TRANSCRIPT_SOURCE',
      `created voice transcript source ${entry.id} in "${exp.title}" | words ${countWords(text)} | hash ${entry.hash}`,
      { projectId: exp.project_id });
  } else if (entry.type === 'ocr_raw_text') {
    Audit.log(req.user.name, req.user.role, 'ADD_OCR_RAW_TEXT_SOURCE',
      `created raw OCR text source ${entry.id} in "${exp.title}" | words ${countWords(text)} | hash ${entry.hash}`,
      { projectId: exp.project_id });
  } else {
    Audit.log(req.user.name, req.user.role, 'ADD_ENTRY', `${entry.type} entry in "${exp.title}"`, { projectId: exp.project_id });
  }
  res.status(201).json(entry);
});

export default r;

function publicExperiment(exp) {
  return { ...exp, entries: (exp.entries || []).filter(en => !isHiddenEntryType(en.type)) };
}

function applyTemplateDefaults(body = {}, template) {
  const withDefaults = { ...body, project_id: body.project_id || template.project_id };
  for (const field of ['objective', 'hypothesis', 'protocol', 'materials', 'success_criteria', 'safety_notes']) {
    if (!String(withDefaults[field] || '').trim()) withDefaults[field] = template[field] || '';
  }
  const hasMetadata = withDefaults.metadata && typeof withDefaults.metadata === 'object' &&
    Object.keys(withDefaults.metadata.extra_fields || withDefaults.metadata).length > 0;
  if (!hasMetadata) withDefaults.metadata = template.metadata || {};
  return withDefaults;
}

function auditText(text, max = 3000) {
  const clean = String(text || '').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function requireExperimentWrite(req, res, next) {
  const exp = Experiments.get(req.params.id, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (archivedReadOnly(exp, res)) return;
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  req.experiment = exp;
  next();
}

function archivedReadOnly(exp, res) {
  if (!exp?.archived_at) return false;
  res.status(409).json({ error: 'Experiment is archived (read-only). Restore it before editing.' });
  return true;
}

function safeName(name) {
  return String(name || 'experiment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'experiment';
}

function safeFolder(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80) || 'unknown';
}

function safeFileName(name) {
  const ext = path.extname(name || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 20);
  const base = path.basename(name || 'attachment', path.extname(name || '')).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'attachment';
  return `${base}${ext || '.dat'}`;
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function exportZipBundle(pkg) {
  const files = [
    {
      path: 'experiment-export.json',
      role: 'machine-readable export',
      contentType: 'application/json',
      data: Buffer.from(JSON.stringify(pkg, null, 2))
    },
    {
      path: 'experiment-export.html',
      role: 'human-readable export',
      contentType: 'text/html',
      data: Buffer.from(exportHtml(pkg))
    },
    {
      path: 'ro-crate-metadata.json',
      role: 'FAIR metadata',
      contentType: 'application/ld+json',
      data: Buffer.from(JSON.stringify(exportRoCrate(pkg), null, 2))
    },
    {
      path: 'audit.json',
      role: 'audit trail',
      contentType: 'application/json',
      data: Buffer.from(JSON.stringify(pkg.audit || [], null, 2))
    }
  ];
  const usedPaths = new Set(files.map(file => file.path));
  const missingAttachments = [];
  for (const att of pkg.attachments || []) {
    const filePath = attachmentDiskPath(att);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      missingAttachments.push({ id: att.id, original_name: att.original_name || att.stored_name || '', sha256: att.hash || '' });
      continue;
    }
    const baseName = safeFileName(att.original_name || att.stored_name || att.id || 'attachment');
    const zipPath = uniqueZipPath(`attachments/${baseName}`, usedPaths);
    usedPaths.add(zipPath);
    files.push({
      path: zipPath,
      role: 'attachment',
      contentType: att.mime_type || 'application/octet-stream',
      sourceId: att.id,
      originalName: att.original_name || att.stored_name || '',
      storedName: att.stored_name || '',
      data: fs.readFileSync(filePath)
    });
  }
  const manifestFiles = files.map(file => ({
    path: file.path,
    role: file.role,
    content_type: file.contentType,
    bytes: file.data.length,
    sha256: sha256Buffer(file.data),
    source_id: file.sourceId || undefined,
    original_name: file.originalName || undefined,
    stored_name: file.storedName || undefined
  }));
  const manifest = {
    bundle_version: 1,
    generated_at: pkg.exported_at,
    experiment_id: pkg.experiment?.id || '',
    eln_id: pkg.experiment?.eln_id || '',
    title: pkg.experiment?.title || '',
    export_sha256: pkg.integrity?.sha256 || '',
    files: manifestFiles,
    missing_attachments: missingAttachments
  };
  return zipStore([
    {
      path: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest, null, 2))
    },
    ...files.map(file => ({ path: file.path, data: file.data }))
  ], pkg.exported_at);
}

function attachmentDiskPath(att) {
  const fromUrl = String(att?.url || '');
  const uploadPrefix = '/uploads/';
  if (fromUrl.startsWith(uploadPrefix)) {
    const rel = fromUrl.slice(uploadPrefix.length).split('/').map(part => decodeURIComponent(part)).join(path.sep);
    const full = path.resolve(UPLOAD_DIR, rel);
    const root = path.resolve(UPLOAD_DIR);
    if (full === root || !full.startsWith(`${root}${path.sep}`)) return null;
    return full;
  }
  const stored = String(att?.stored_name || '').trim();
  const experimentId = String(att?.experiment_id || '').trim();
  if (!stored || !experimentId) return null;
  return path.join(ATTACHMENT_DIR, safeFolder(experimentId), safeFileName(stored));
}

function uniqueZipPath(candidate, used) {
  const normalized = String(candidate || 'attachment.dat').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!used.has(normalized)) return normalized;
  const ext = path.posix.extname(normalized);
  const base = normalized.slice(0, normalized.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}-${i}${ext}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${randomUUID().slice(0, 8)}${ext}`;
}

function zipStore(files, isoDate) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(isoDate);
  for (const file of files) {
    const name = Buffer.from(zipEntryName(file.path), 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function zipEntryName(name) {
  const clean = String(name || 'file.dat').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('..') || path.posix.isAbsolute(clean)) return 'file.dat';
  return clean;
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function dosDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

const crc32Table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function exportHtml(pkg) {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const exp = pkg.experiment;
  const setup = experimentSetupItems(exp);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(exp.title)} export</title>
  <style>body{font-family:system-ui,sans-serif;max-width:980px;margin:32px auto;padding:0 20px;line-height:1.45} pre{white-space:pre-wrap} .muted{color:#667085}.entry{border-top:1px solid #ddd;padding:14px 0}.hash{font-family:ui-monospace,monospace;font-size:12px}dt{font-weight:700;margin-top:10px}dd{margin:2px 0 0 0;white-space:pre-wrap}</style></head>
  <body><h1>${esc(exp.title)}</h1><p class="muted">${esc(exp.project_name || exp.project || 'General')} · ${esc(exp.status)}</p>
  ${exp.eln_id ? `<p><b>ELN ID:</b> ${esc(exp.eln_id)}</p>` : ''}
  ${exp.tags ? `<p><b>Tags:</b> ${esc(exp.tags)}</p>` : ''}
  <h2>Objective</h2><p>${esc(exp.objective || '')}</p>
  <h2>Study setup</h2><dl>${setup.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value || 'Not set')}</dd>`).join('')}</dl>
  <h2>Custom Metadata</h2><dl>${metadataItems(exp.metadata).map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value || 'Not set')}</dd>`).join('') || '<dd>None</dd>'}</dl>
  <h2>Outcome</h2><dl><dt>Status</dt><dd>${esc(outcomeStatusLabel(exp.outcome_status))}</dd><dt>Result note</dt><dd>${esc(exp.outcome_summary || 'Not set')}</dd></dl>
  <h2>Related Experiments</h2><ul>${(pkg.experiment_links || []).map(link =>
    `<li>${esc(link.linked_title)}${link.note ? ` - ${esc(link.note)}` : ''}</li>`).join('') || '<li>None</li>'}</ul>
  <h2>Procedure steps</h2><ol>${(pkg.steps || []).map(step =>
    `<li>${step.done ? '[done] ' : '[open] '}${esc(step.text)}${step.completed_at ? ` <span class="muted">completed ${esc(step.completed_at)} by ${esc(step.completed_by || 'Unknown')}</span>` : ''}</li>`).join('') || '<li>None</li>'}</ol>
  <h2>Attachments</h2><ul>${(pkg.attachments || []).map(att =>
    `<li>${esc(att.original_name)} (${esc(formatBytes(att.size))})${att.note ? ` - ${esc(att.note)}` : ''}<br><span class="hash">sha256 ${esc(att.hash)}</span></li>`).join('') || '<li>None</li>'}</ul>
  <h2>Notebook Entries</h2>${(exp.entries || []).map(en => exportEntryHtml(en, esc)).join('') || '<p>No entries.</p>'}
  <h2>References</h2><ul>${(pkg.references || []).map(r => `<li>${esc(r.title)} ${r.year ? `(${esc(r.year)})` : ''}</li>`).join('') || '<li>None</li>'}</ul>
  <h2>Integrity</h2><p class="hash">Export SHA-256: ${esc(pkg.integrity.sha256)}</p>
  <p class="muted">Exported ${esc(pkg.exported_at)} by ${esc(pkg.exported_by.name || pkg.exported_by.email)}.</p></body></html>`;
}

function exportEntryHtml(en, esc) {
  const comments = (en.comments || []).map(c => `<li><b>${esc(c.author || 'Unknown')}</b> · ${esc(c.created_at)}<br>${esc(c.text || '')}</li>`).join('');
  const revisions = (en.revisions || []).map(rev =>
    `<li><b>Revision ${esc(rev.revision_no)}</b> · edited ${esc(rev.created_at)} by ${esc(rev.edited_by || 'Unknown')}<br>
      <span class="hash">previous hash ${esc(rev.previous_hash || '')}</span><pre>${esc(rev.previous_text || '')}</pre></li>`
  ).join('');
  return `<div class="entry"><b>${esc(en.type)}</b> · ${esc(en.created_at)} · ${esc(en.author || '')}<pre>${esc(en.text)}</pre><div class="hash">hash ${esc(en.hash)}${en.sig ? ` · sig ${esc(en.sig)}` : ''}</div>${revisions ? `<h3>Revisions</h3><ul>${revisions}</ul>` : ''}${comments ? `<h3>Comments</h3><ul>${comments}</ul>` : ''}</div>`;
}

function exportPdf(pkg) {
  const exp = pkg.experiment;
  const pdf = new PdfDocument();

  pdf.text(exp.title, { size: 18, font: 'F2', gap: 18 });
  pdf.text(`${exp.project_name || exp.project || 'General'} | ${exp.status}`, { size: 10, gap: 5 });
  if (exp.eln_id) pdf.text(`ELN ID: ${exp.eln_id}`, { size: 9, gap: 5 });
  if (exp.tags) pdf.text(`Tags: ${exp.tags}`, { size: 9, gap: 5 });
  pdf.text(`Exported ${pkg.exported_at} by ${pkg.exported_by.name || pkg.exported_by.email}`, { size: 9, gap: 5 });
  pdf.text(`Export SHA-256: ${pkg.integrity.sha256}`, { size: 8, gap: 18 });

  pdf.heading('Objective');
  pdf.paragraph(exp.objective || 'No objective set.');

  pdf.heading('Study setup');
  experimentSetupItems(exp).forEach(([label, value]) => {
    pdf.text(label, { size: 10, font: 'F2', gap: 3 });
    pdf.paragraph(value || 'Not set');
  });

  pdf.heading('Custom Metadata');
  const metadata = metadataItems(exp.metadata);
  if (metadata.length) {
    metadata.forEach(([label, value]) => {
      pdf.text(label, { size: 10, font: 'F2', gap: 3 });
      pdf.paragraph(value || 'Not set');
    });
  } else {
    pdf.paragraph('None.');
  }

  pdf.heading('Outcome');
  pdf.text('Status', { size: 10, font: 'F2', gap: 3 });
  pdf.paragraph(outcomeStatusLabel(exp.outcome_status));
  pdf.text('Result note', { size: 10, font: 'F2', gap: 3 });
  pdf.paragraph(exp.outcome_summary || 'Not set');

  pdf.heading('Related Experiments');
  if ((pkg.experiment_links || []).length) {
    pkg.experiment_links.forEach((link, index) => {
      pdf.paragraph(`${index + 1}. ${link.linked_title}${link.note ? ` - ${link.note}` : ''}`);
    });
  } else {
    pdf.paragraph('None.');
  }

  pdf.heading('Procedure Steps');
  if ((pkg.steps || []).length) {
    pkg.steps.forEach((step, index) => {
      pdf.paragraph(`${index + 1}. ${step.done ? '[done]' : '[open]'} ${step.text}${step.completed_at ? ` | completed ${step.completed_at} by ${step.completed_by || 'Unknown'}` : ''}`);
    });
  } else {
    pdf.paragraph('None.');
  }

  pdf.heading('Attachments');
  if ((pkg.attachments || []).length) {
    pkg.attachments.forEach((att, index) => {
      pdf.paragraph(`${index + 1}. ${att.original_name} (${formatBytes(att.size)})${att.note ? ` - ${att.note}` : ''}`);
      pdf.text(`sha256 ${att.hash}`, { size: 8, gap: 8 });
    });
  } else {
    pdf.paragraph('None.');
  }

  pdf.heading(`Notebook Entries (${(exp.entries || []).length})`);
  if ((exp.entries || []).length) {
    exp.entries.forEach((en, index) => {
      pdf.text(`${index + 1}. ${en.type} | ${en.created_at} | ${en.author || 'Unknown'}`, { size: 11, font: 'F2', gap: 5 });
      pdf.paragraph(en.text || '');
      pdf.text(`hash ${en.hash}${en.sig ? ` | sig ${en.sig}` : ''}`, { size: 8, gap: en.signed_by ? 3 : 12 });
      if (en.signed_by) {
        pdf.text(`signed ${en.signed_at || ''} by ${en.signed_by} (${en.signature_meaning || 'signed'})`, { size: 8, gap: 12 });
      }
      if (en.revisions?.length) {
        pdf.text(`Revisions (${en.revisions.length})`, { size: 10, font: 'F2', gap: 3 });
        en.revisions.forEach(rev => {
          pdf.paragraph(`Revision ${rev.revision_no} | edited ${rev.created_at} by ${rev.edited_by || 'Unknown'} | previous hash ${rev.previous_hash || ''}`);
          pdf.paragraph(rev.previous_text || '');
        });
      }
      if (en.comments?.length) {
        pdf.text('Comments', { size: 10, font: 'F2', gap: 3 });
        en.comments.forEach(comment => {
          pdf.paragraph(`${comment.author || 'Unknown'} | ${comment.created_at}: ${comment.text || ''}`);
        });
      }
    });
  } else {
    pdf.paragraph('No entries.');
  }

  pdf.heading('References');
  if ((pkg.references || []).length) {
    pkg.references.forEach((ref, index) => {
      pdf.paragraph(`${index + 1}. ${[ref.title, ref.year ? `(${ref.year})` : '', ref.doi || ref.url || ''].filter(Boolean).join(' ')}`);
    });
  } else {
    pdf.paragraph('None.');
  }

  pdf.heading('Integrity');
  pdf.paragraph(`This export records the same SHA-256 package fingerprint as the JSON and HTML exports: ${pkg.integrity.sha256}`);
  return pdf.toBuffer();
}

function exportRoCrate(pkg) {
  const exp = pkg.experiment;
  const expId = `experiments/${exp.id}`;
  const entryParts = (exp.entries || []).map(en => ({ '@id': `entries/${en.id}` }));
  const attachmentParts = (pkg.attachments || []).map(att => ({ '@id': `attachments/${att.id}` }));
  const referenceParts = (pkg.references || []).map(ref => ({ '@id': `references/${ref.id}` }));
  const recordId = exp.eln_id || exp.id;
  const graph = [
    {
      '@id': 'ro-crate-metadata.json',
      '@type': 'CreativeWork',
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
      about: { '@id': './' }
    },
    {
      '@id': './',
      '@type': 'Dataset',
      name: `${exp.title} evidence export`,
      description: exp.objective || '',
      identifier: recordId,
      datePublished: pkg.exported_at,
      creator: personNode(pkg.exported_by),
      hasPart: [
        { '@id': expId },
        ...attachmentParts,
        ...referenceParts,
        { '@id': `audit/${exp.id}` }
      ]
    },
    {
      '@id': expId,
      '@type': 'Dataset',
      name: exp.title,
      description: exp.objective || '',
      identifier: recordId,
      dateCreated: exp.created_at,
      dateModified: exp.updated_at,
      keywords: splitTags(exp.tags),
      isPartOf: { '@id': './' },
      about: [exp.project_name || exp.project || exp.project_id || 'General', outcomeStatusLabel(exp.outcome_status)].filter(Boolean),
      additionalProperty: [
        ...experimentSetupItems(exp).map(([name, value]) => propertyValue(name, value || '')),
        propertyValue('Outcome status', outcomeStatusLabel(exp.outcome_status)),
        propertyValue('Outcome note', exp.outcome_summary || ''),
        propertyValue('Export SHA-256', pkg.integrity.sha256)
      ],
      variableMeasured: metadataItems(exp.metadata).map(([name, value]) => propertyValue(name, value || '')),
      hasPart: [...entryParts, ...attachmentParts, ...referenceParts]
    },
    ...(exp.entries || []).map(entryRoCrateNode),
    ...(pkg.attachments || []).map(attachmentRoCrateNode),
    ...(pkg.references || []).map(referenceRoCrateNode),
    {
      '@id': `audit/${exp.id}`,
      '@type': 'CreativeWork',
      name: `${exp.title} audit trail`,
      encodingFormat: 'application/json',
      dateCreated: pkg.exported_at,
      sha256: pkg.integrity.sha256,
      text: JSON.stringify((pkg.audit || []).filter(row => !row.project_id || row.project_id === exp.project_id))
    }
  ];
  return {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': graph,
    export_version: pkg.export_version,
    exported_at: pkg.exported_at,
    integrity: pkg.integrity
  };
}

function entryRoCrateNode(en) {
  return {
    '@id': `entries/${en.id}`,
    '@type': 'CreativeWork',
    name: `${en.type || 'note'} entry ${en.id}`,
    text: en.text || '',
    encodingFormat: 'text/plain',
    dateCreated: en.created_at,
    dateModified: en.updated_at || en.created_at,
    author: personNode({ name: en.author, role: en.role }),
    isPartOf: { '@id': `experiments/${en.experiment_id}` },
    sha256: en.hash,
    digitalSignature: en.sig || undefined,
    additionalProperty: [
      en.signed_by ? propertyValue('Signed by', en.signed_by) : null,
      en.signed_at ? propertyValue('Signed at', en.signed_at) : null,
      en.signature_meaning ? propertyValue('Signature meaning', en.signature_meaning) : null,
      en.revision_count ? propertyValue('Revision count', en.revision_count) : null
    ].filter(Boolean)
  };
}

function attachmentRoCrateNode(att) {
  return {
    '@id': `attachments/${att.id}`,
    '@type': 'MediaObject',
    name: att.original_name || att.stored_name || att.id,
    description: att.note || '',
    contentUrl: att.url,
    encodingFormat: att.mime_type || 'application/octet-stream',
    contentSize: Number(att.size) || 0,
    dateCreated: att.uploaded_at || att.created_at,
    author: personNode({ name: att.uploaded_by }),
    sha256: att.hash,
    isPartOf: { '@id': `experiments/${att.experiment_id}` }
  };
}

function referenceRoCrateNode(ref) {
  return {
    '@id': `references/${ref.id}`,
    '@type': 'ScholarlyArticle',
    name: ref.title || ref.doi || ref.url || ref.id,
    author: ref.authors || '',
    datePublished: ref.year ? String(ref.year) : undefined,
    identifier: ref.doi || ref.url || ref.id,
    url: ref.url || undefined,
    sameAs: ref.doi ? `https://doi.org/${ref.doi}` : undefined,
    isPartOf: { '@id': `experiments/${ref.experiment_id}` }
  };
}

function propertyValue(name, value) {
  return { '@type': 'PropertyValue', name, value: String(value || '') };
}

function personNode(person = {}) {
  return {
    '@type': 'Person',
    name: person.name || person.email || 'Unknown',
    email: person.email || undefined,
    roleName: person.role || undefined
  };
}

function splitTags(value) {
  return String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);
}

function experimentSetupItems(exp) {
  return [
    ['Hypothesis', exp.hypothesis],
    ['Protocol / method', exp.protocol],
    ['Materials / reagents', exp.materials],
    ['Success criteria', exp.success_criteria],
    ['Safety notes', exp.safety_notes]
  ];
}

function metadataItems(metadata) {
  const fields = metadata?.extra_fields && typeof metadata.extra_fields === 'object' ? metadata.extra_fields : {};
  return Object.entries(fields)
    .map(([label, field]) => [
      label,
      [field?.value, field?.unit].filter(Boolean).join(' ')
    ])
    .sort((a, b) => {
      const fieldsObj = metadata?.extra_fields || {};
      const ap = Number(fieldsObj[a[0]]?.position) || 0;
      const bp = Number(fieldsObj[b[0]]?.position) || 0;
      return ap - bp || a[0].localeCompare(b[0]);
    });
}

function outcomeStatusLabel(status) {
  return {
    running: 'Running',
    needs_redo: 'Needs redo',
    success: 'Success',
    fail: 'Fail',
    inconclusive: 'Inconclusive'
  }[String(status || 'running')] || 'Running';
}

class PdfDocument {
  constructor() {
    this.width = 595.28;
    this.height = 841.89;
    this.margin = 48;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.page = [];
    this.y = this.height - this.margin;
    this.pages.push(this.page);
  }

  heading(text) {
    this.text(text, { size: 13, font: 'F2', gap: 7 });
  }

  paragraph(text) {
    const maxWidth = this.width - this.margin * 2;
    for (const line of wrapPdfText(text, maxWidth, 10)) this.text(line, { size: 10, gap: 3 });
    this.y -= 7;
  }

  text(text, { size = 10, font = 'F1', gap = 4 } = {}) {
    const maxWidth = this.width - this.margin * 2;
    const lines = wrapPdfText(text, maxWidth, size);
    if (!lines.length) lines.push('');
    lines.forEach((line, index) => this.drawLine(line, {
      size,
      font,
      gap: index === lines.length - 1 ? gap : 2
    }));
  }

  drawLine(text, { size = 10, font = 'F1', gap = 4 } = {}) {
    const leading = Math.max(size + 4, 12);
    if (this.y < this.margin + leading) this.newPage();
    this.page.push(`BT /${font} ${size} Tf 1 0 0 1 ${this.margin} ${this.y.toFixed(2)} Tm ${pdfString(text)} Tj ET`);
    this.y -= leading + gap;
  }

  toBuffer() {
    const objects = [];
    const add = value => { objects.push(value); return objects.length; };
    const catalogId = add('');
    const pagesId = add('');
    const fontRegularId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pageIds = [];

    for (const page of this.pages) {
      const stream = page.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, index) => {
      offsets.push(Buffer.byteLength(out, 'utf8'));
      out += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(out, 'utf8');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { out += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(out, 'utf8');
  }
}

function wrapPdfText(value, maxWidth, size) {
  const maxChars = Math.max(24, Math.floor(maxWidth / (size * 0.52)));
  const lines = [];
  const paragraphs = normalPdfText(value).split(/\r?\n/);
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!line) {
        line = word;
      } else if ((line + ' ' + word).length <= maxChars) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
      while (line.length > maxChars) {
        lines.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function pdfString(value) {
  return `(${normalPdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function normalPdfText(value) {
  return String(value == null ? '' : value)
    .replace(/[–—]/g, '-')
    .replace(/µ/g, 'u')
    .replace(/°/g, ' deg ')
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
