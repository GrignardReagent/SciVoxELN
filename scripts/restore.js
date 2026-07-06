import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const BACKUP_PATH = process.env.BACKUP_PATH;

if (!BACKUP_PATH) {
  console.error('Set BACKUP_PATH=/path/to/scivox-backup-* before running restore.');
  process.exit(1);
}
if (!fs.existsSync(path.join(BACKUP_PATH, 'manifest.json'))) {
  console.error('Backup manifest.json not found. Refusing to restore.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
copyDir(BACKUP_PATH, DATA_DIR, new Set(['manifest.json']));
console.log(`Restored ${BACKUP_PATH} into ${DATA_DIR}`);

function copyDir(src, dest, skipNames) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.has(ent.name)) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDir(from, to, skipNames);
    } else if (ent.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}
