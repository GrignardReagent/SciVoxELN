/** Image uploads for OCR/scanned notes. Stored on disk, served from /uploads. */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Audit, Experiments, Projects } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

const r = Router();

r.post('/', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const evidence = evidenceUploadContext(req);
  if (evidence.error) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(evidence.error.status).json({ error: evidence.error.error });
  }
  const folder = uploadFolder(req.body?.kind, req.body?.experimentId);
  if (folder) {
    const dir = path.join(UPLOAD_DIR, ...folder.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, req.file.filename);
    fs.renameSync(req.file.path, target);
    const url = `/uploads/${folder}/${req.file.filename}`;
    if (evidence.exp) {
      Audit.log(
        req.user.name,
        req.user.role,
        'UPLOAD_EVIDENCE',
        `${req.body?.kind} upload "${req.file.originalname}" for experiment ${evidence.exp.id} -> ${url} (${req.file.size} bytes, sha256 ${fileSha256(target)})`,
        { projectId: evidence.exp.project_id }
      );
    }
    return res.status(201).json({ url });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default r;

function uploadFolder(kind, experimentId = '') {
  const expFolder = safeFolder(experimentId) || 'unassigned';
  if (kind === 'figure-raw') return `figures/${expFolder}/raw`;
  if (kind === 'figure-clean') return `figures/${expFolder}/clean`;
  if (kind === 'ocr-raw') return `ocr/${expFolder}/raw`;
  if (kind === 'ocr-clean') return `ocr/${expFolder}/clean`;
  return '';
}

function evidenceUploadContext(req) {
  const kind = req.body?.kind || '';
  if (!isExperimentEvidenceKind(kind)) return {};
  const experimentId = req.body?.experimentId || '';
  if (!experimentId) return { error: { status: 400, error: 'experimentId required for experiment evidence uploads' } };
  const exp = Experiments.get(experimentId, req.user);
  if (!exp) return { error: { status: 404, error: 'Experiment not found' } };
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) {
    return { error: { status: 403, error: 'Project write access required' } };
  }
  if (exp.archived_at) return { error: { status: 409, error: 'Experiment is archived (read-only). Restore it before editing.' } };
  if (exp.status === 'locked') return { error: { status: 409, error: 'Experiment is locked (read-only)' } };
  return { exp };
}

function isExperimentEvidenceKind(kind) {
  return ['figure-raw', 'figure-clean', 'ocr-raw', 'ocr-clean'].includes(kind);
}

function safeFolder(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
