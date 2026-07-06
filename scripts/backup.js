import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(BACKUP_DIR, `scivox-backup-${stamp}`);

fs.mkdirSync(out, { recursive: true });
copyDir(DATA_DIR, out, new Set([path.resolve(BACKUP_DIR)]));

const manifest = {
  created_at: new Date().toISOString(),
  source: path.resolve(DATA_DIR),
  backup: path.resolve(out),
  files: listFiles(out).map(f => path.relative(out, f))
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Backup written to ${out}`);

function copyDir(src, dest, excluded) {
  if (!fs.existsSync(src)) return;
  const real = path.resolve(src);
  if ([...excluded].some(ex => real === ex || real.startsWith(ex + path.sep))) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to, excluded);
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}
