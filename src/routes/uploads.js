/** Image uploads for OCR/scanned notes. Stored on disk, served from /uploads. */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
  const folder = uploadFolder(req.body?.kind, req.body?.experimentId);
  if (folder) {
    const dir = path.join(UPLOAD_DIR, ...folder.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, req.file.filename);
    fs.renameSync(req.file.path, target);
    return res.status(201).json({ url: `/uploads/${folder}/${req.file.filename}` });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default r;

function uploadFolder(kind, experimentId = '') {
  const expFolder = safeFolder(experimentId) || 'unassigned';
  if (kind === 'figure-raw') return `figures/${expFolder}/raw`;
  if (kind === 'figure-clean') return `figures/${expFolder}/clean`;
  return '';
}

function safeFolder(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
}
