import { Router } from 'express';
import { Audit, Entries, ExperimentExports, Experiments, Projects, Refs, fingerprint } from '../db.js';
import { requireRole } from '../auth.js';

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
  const format = req.query.format === 'html' ? 'html' : req.query.format === 'pdf' ? 'pdf' : 'json';
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

function exportPdf(pkg) {
  const exp = pkg.experiment;
  const pdf = new PdfDocument();

  pdf.text(exp.title, { size: 18, font: 'F2', gap: 18 });
  pdf.text(`${exp.project_name || exp.project || 'General'} | ${exp.status}`, { size: 10, gap: 5 });
  pdf.text(`Exported ${pkg.exported_at} by ${pkg.exported_by.name || pkg.exported_by.email}`, { size: 9, gap: 5 });
  pdf.text(`Export SHA-256: ${pkg.integrity.sha256}`, { size: 8, gap: 18 });

  pdf.heading('Objective');
  pdf.paragraph(exp.objective || 'No objective set.');

  pdf.heading(`Notebook Entries (${(exp.entries || []).length})`);
  if ((exp.entries || []).length) {
    exp.entries.forEach((en, index) => {
      pdf.text(`${index + 1}. ${en.type} | ${en.created_at} | ${en.author || 'Unknown'}`, { size: 11, font: 'F2', gap: 5 });
      pdf.paragraph(en.text || '');
      pdf.text(`hash ${en.hash}${en.sig ? ` | sig ${en.sig}` : ''}`, { size: 8, gap: en.signed_by ? 3 : 12 });
      if (en.signed_by) {
        pdf.text(`signed ${en.signed_at || ''} by ${en.signed_by} (${en.signature_meaning || 'signed'})`, { size: 8, gap: 12 });
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
