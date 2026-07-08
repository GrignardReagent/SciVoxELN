/**
 * Paper references attached to an experiment.
 *
 * Ways to add references, covering both Zotero and Mendeley:
 *   - DOI lookup via CrossRef (no API key needed)
 *   - Paste/import BibTeX or RIS  (Zotero AND Mendeley both export these)
 *   - Import directly from a Zotero library via the Zotero Web API
 *   - Manual entry
 *
 * Base URLs are overridable (CROSSREF_BASE, ZOTERO_BASE) so the flows are
 * testable against a mock server.
 */
import { Router } from 'express';
import { Experiments, Projects, Refs, Audit } from '../db.js';

const r = Router();
const CROSSREF = (process.env.CROSSREF_BASE || 'https://api.crossref.org').replace(/\/$/, '');
const ZOTERO = (process.env.ZOTERO_BASE || 'https://api.zotero.org').replace(/\/$/, '');

const expOr404 = (req, res, { minRole = 'viewer', requireUnlocked = false } = {}) => {
  const exp = Experiments.get(req.body?.experimentId || req.query.experimentId, req.user);
  if (!exp) { res.status(404).json({ error: 'Experiment not found' }); return null; }
  if (!Projects.canAccessProject(req.user, exp.project_id, minRole)) {
    res.status(minRole === 'viewer' ? 404 : 403).json({ error: minRole === 'viewer' ? 'Experiment not found' : 'Project write access required' });
    return null;
  }
  if (requireUnlocked && exp.status === 'locked') {
    res.status(409).json({ error: 'Experiment is locked (read-only)' });
    return null;
  }
  if (requireUnlocked && exp.archived_at) {
    res.status(409).json({ error: 'Experiment is archived (read-only). Restore it before editing.' });
    return null;
  }
  return exp;
};

/* ---- list ---- */
r.get('/', (req, res) => {
  const exp = expOr404(req, res); if (!exp) return;
  res.json(Refs.listByExperiment(exp.id));
});

/* ---- manual add ---- */
r.post('/', (req, res) => {
  const exp = expOr404(req, res, { minRole: 'scientist', requireUnlocked: true }); if (!exp) return;
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const ref = Refs.create(exp.id, { ...req.body, source: 'manual', created_by: req.user.name });
  Audit.log(req.user.name, req.user.role, 'ADD_REFERENCE', `manual "${ref.title}" → "${exp.title}"`, { projectId: exp.project_id });
  res.status(201).json(ref);
});

/* ---- add by DOI (CrossRef) ---- */
r.post('/doi', async (req, res) => {
  const exp = expOr404(req, res, { minRole: 'scientist', requireUnlocked: true }); if (!exp) return;
  const doi = (req.body?.doi || '').trim();
  if (!doi) return res.status(400).json({ error: 'DOI is required' });
  try {
    const meta = await crossref(doi);
    if (Refs.findByDoi(exp.id, meta.doi)) return res.status(409).json({ error: 'That DOI is already referenced here' });
    const ref = Refs.create(exp.id, { ...meta, created_by: req.user.name });
    Audit.log(req.user.name, req.user.role, 'ADD_REFERENCE', `doi ${meta.doi} → "${exp.title}"`, { projectId: exp.project_id });
    res.status(201).json(ref);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---- import BibTeX / RIS (paste from Zotero or Mendeley export) ---- */
r.post('/import', (req, res) => {
  const exp = expOr404(req, res, { minRole: 'scientist', requireUnlocked: true }); if (!exp) return;
  const text = req.body?.text || '';
  if (!text.trim()) return res.status(400).json({ error: 'Paste BibTeX or RIS content' });
  const fmt = /(^|\n)\s*@\w+\s*\{/.test(text) ? 'bibtex'
    : /(^|\n)[A-Z0-9]{2}\s{1,2}-/.test(text) ? 'ris' : null;
  if (!fmt) return res.status(400).json({ error: 'Could not detect BibTeX or RIS format' });
  const parsed = fmt === 'bibtex' ? parseBibtex(text) : parseRis(text);
  const added = addAll(exp.id, parsed, req.user.name);
  Audit.log(req.user.name, req.user.role, 'IMPORT_REFERENCES', `${added.length} from ${fmt} → "${exp.title}"`, { projectId: exp.project_id });
  res.status(201).json({ added: added.length, skipped: parsed.length - added.length, refs: added });
});

/* ---- import from a Zotero library ---- */
r.post('/zotero', async (req, res) => {
  const exp = expOr404(req, res, { minRole: 'scientist', requireUnlocked: true }); if (!exp) return;
  const userId = (req.body?.userId || process.env.ZOTERO_USER_ID || '').trim();
  const apiKey = (req.body?.apiKey || process.env.ZOTERO_API_KEY || '').trim();
  const collectionKey = (req.body?.collectionKey || '').trim();
  if (!userId) return res.status(400).json({ error: 'Zotero numeric user ID is required' });
  try {
    const items = await zoteroImport({ userId, apiKey, collectionKey });
    const added = addAll(exp.id, items, req.user.name, 'zotero');
    Audit.log(req.user.name, req.user.role, 'IMPORT_REFERENCES', `${added.length} from Zotero → "${exp.title}"`, { projectId: exp.project_id });
    res.status(201).json({ added: added.length, skipped: items.length - added.length, refs: added });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---- delete ---- */
r.delete('/:id', (req, res) => {
  const ref = Refs.get(req.params.id);
  if (!ref) return res.status(404).json({ error: 'Reference not found' });
  const exp = Experiments.get(ref.experiment_id, req.user);
  if (!exp) return res.status(404).json({ error: 'Reference not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (exp.archived_at) return res.status(409).json({ error: 'Experiment is archived (read-only). Restore it before editing.' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });
  Refs.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_REFERENCE', `"${ref.title}"`, { projectId: exp.project_id });
  res.json({ ok: true });
});

export default r;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function addAll(expId, list, user, forceSource) {
  const added = [];
  for (const item of list) {
    if (!item || !item.title) continue;
    if (item.doi && Refs.findByDoi(expId, item.doi)) continue; // dedupe by DOI
    added.push(Refs.create(expId, { ...item, source: forceSource || item.source || 'manual', created_by: user }));
  }
  return added;
}

async function crossref(doi) {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const res = await fetch(`${CROSSREF}/works/${encodeURIComponent(clean)}`, {
    headers: { accept: 'application/json', 'user-agent': 'SciVox-ELN/1.0 (mailto:support@scivox.local)' }
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'DOI not found' : `CrossRef error ${res.status}`);
  const m = (await res.json()).message || {};
  const authors = (m.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(', ');
  const year = m.issued?.['date-parts']?.[0]?.[0] || '';
  const title = Array.isArray(m.title) ? m.title[0] : (m.title || 'Untitled');
  return { title, authors, year: String(year || ''), doi: m.DOI || clean, url: m.URL || `https://doi.org/${m.DOI || clean}`, source: 'doi', external_id: m.DOI || clean };
}

function parseBibtex(text) {
  const out = [];
  const entries = text.split(/@(?=\w+\s*\{)/).slice(1);
  for (const raw of entries) {
    const body = raw.slice(raw.indexOf('{') + 1);
    const fields = {};
    const re = /(\w+)\s*=\s*(\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|([^,\n]+))/g;
    let mm;
    while ((mm = re.exec(body))) {
      fields[mm[1].toLowerCase()] = (mm[3] ?? mm[4] ?? mm[5] ?? '').trim().replace(/[{}]/g, '');
    }
    if (!fields.title && !fields.doi) continue;
    out.push({
      title: fields.title || 'Untitled',
      authors: (fields.author || '').replace(/\s+and\s+/gi, ', '),
      year: (String(fields.year || '').match(/\d{4}/) || [''])[0],
      doi: fields.doi || '',
      url: fields.url || (fields.doi ? `https://doi.org/${fields.doi}` : ''),
      source: 'bibtex'
    });
  }
  return out;
}

function parseRis(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9]{2})\s{1,2}-\s?(.*)$/);
    if (!m) continue;
    const tag = m[1], val = m[2];
    if (tag === 'TY') cur = { authors: [], title: '', year: '', doi: '', url: '' };
    else if (!cur) continue;
    else if (tag === 'TI' || tag === 'T1') cur.title = val;
    else if (tag === 'AU' || tag === 'A1') cur.authors.push(val);
    else if (tag === 'PY' || tag === 'Y1') cur.year = (val.match(/\d{4}/) || [''])[0];
    else if (tag === 'DO') cur.doi = val;
    else if (tag === 'UR') cur.url = val;
    else if (tag === 'ER') {
      if (cur.title || cur.doi) out.push({
        title: cur.title || 'Untitled', authors: cur.authors.join(', '), year: cur.year,
        doi: cur.doi, url: cur.url || (cur.doi ? `https://doi.org/${cur.doi}` : ''), source: 'ris'
      });
      cur = null;
    }
  }
  return out;
}

async function zoteroImport({ userId, apiKey, collectionKey }) {
  const path = collectionKey
    ? `/users/${userId}/collections/${collectionKey}/items/top`
    : `/users/${userId}/items/top`;
  const headers = { accept: 'application/json' };
  if (apiKey) headers['Zotero-API-Key'] = apiKey;
  const res = await fetch(`${ZOTERO}${path}?format=json&limit=100`, { headers });
  if (!res.ok) throw new Error(res.status === 403 ? 'Zotero access denied — check user ID / API key' : `Zotero API ${res.status}`);
  const items = await res.json();
  return (Array.isArray(items) ? items : []).map(it => it.data).filter(d => d && d.itemType && !['attachment', 'note'].includes(d.itemType)).map(d => ({
    title: d.title || 'Untitled',
    authors: (d.creators || []).map(c => c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', '),
    year: (String(d.date || '').match(/\d{4}/) || [''])[0],
    doi: d.DOI || '',
    url: d.url || (d.DOI ? `https://doi.org/${d.DOI}` : ''),
    source: 'zotero',
    external_id: d.key || ''
  }));
}
