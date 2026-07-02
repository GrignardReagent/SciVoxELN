/**
 * Data-access layer for SciVox ELN.
 *
 * Uses Node's built-in `node:sqlite` driver (Node >= 22.5). Keeping all SQL in
 * this single module means the rest of the app never touches the database
 * directly — so migrating to Postgres/MySQL later only requires re-implementing
 * the exported repository functions here (the route handlers stay untouched).
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'scivox.db');

export const db = new DatabaseSync(DB_PATH);
// WAL is faster but needs shared-memory support, which some network/on-prem
// filesystems lack. Try it, fall back to the portable DELETE journal if not.
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch {
  try { db.exec('PRAGMA journal_mode = DELETE;'); } catch { /* keep default */ }
}
db.exec('PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ */
/* Schema (idempotent migrations)                                      */
/* ------------------------------------------------------------------ */
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      project     TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',   -- planned | active | locked
      objective   TEXT DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id            TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      type          TEXT NOT NULL DEFAULT 'note',    -- note | voice | ocr
      author        TEXT DEFAULT 'Unknown',
      role          TEXT DEFAULT '',
      text          TEXT NOT NULL,
      image_url     TEXT,
      hash          TEXT NOT NULL,
      signed_by     TEXT,
      signed_role   TEXT,
      signed_at     TEXT,
      sig           TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_exp ON entries(experiment_id);

    CREATE TABLE IF NOT EXISTS plans (
      id               TEXT PRIMARY KEY,
      experiment_id    TEXT REFERENCES experiments(id) ON DELETE SET NULL,
      title            TEXT NOT NULL,
      hypothesis       TEXT DEFAULT '',
      variables        TEXT DEFAULT '[]',            -- JSON array
      steps            TEXT DEFAULT '[]',            -- JSON array of {text, done}
      materials        TEXT DEFAULT '[]',            -- JSON array of {itemId?, name, amount, unit}
      expected_outcome TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'draft', -- draft | ready | started | archived
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      category       TEXT DEFAULT '',
      catalog_number TEXT DEFAULT '',
      lot_number     TEXT DEFAULT '',
      location       TEXT DEFAULT '',
      quantity       REAL NOT NULL DEFAULT 0,
      unit           TEXT DEFAULT '',
      reorder_level  REAL NOT NULL DEFAULT 0,
      expiry_date    TEXT,
      notes          TEXT DEFAULT '',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit (
      id     TEXT PRIMARY KEY,
      ts     TEXT NOT NULL,
      user   TEXT DEFAULT 'Unknown',
      role   TEXT DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
  `);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const now = () => new Date().toISOString();
const id = () => randomUUID();

/** djb2 content fingerprint — tamper-evidence for entries (demo-grade). */
export function fingerprint(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */
export const Audit = {
  log(user, role, action, detail = '') {
    db.prepare('INSERT INTO audit (id, ts, user, role, action, detail) VALUES (?,?,?,?,?,?)')
      .run(id(), now(), user || 'Unknown', role || '', action, detail);
  },
  list(limit = 1000) {
    return db.prepare('SELECT * FROM audit ORDER BY ts DESC LIMIT ?').all(limit);
  }
};

/* ------------------------------------------------------------------ */
/* Experiments                                                         */
/* ------------------------------------------------------------------ */
export const Experiments = {
  list() {
    const rows = db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all();
    const counts = db.prepare('SELECT experiment_id, COUNT(*) n FROM entries GROUP BY experiment_id').all();
    const map = Object.fromEntries(counts.map(c => [c.experiment_id, c.n]));
    return rows.map(r => ({ ...r, entryCount: map[r.id] || 0 }));
  },
  get(expId) {
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(expId);
    if (!exp) return null;
    exp.entries = db.prepare('SELECT * FROM entries WHERE experiment_id = ? ORDER BY created_at ASC').all(expId);
    return exp;
  },
  create({ title, project = '', objective = '', status = 'active' }) {
    const _id = id(), t = now();
    db.prepare('INSERT INTO experiments (id,title,project,status,objective,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(_id, title, project, status, objective, t, t);
    return this.get(_id);
  },
  update(expId, fields) {
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(expId);
    if (!exp) return null;
    const next = { ...exp, ...fields, updated_at: now() };
    db.prepare('UPDATE experiments SET title=?,project=?,status=?,objective=?,updated_at=? WHERE id=?')
      .run(next.title, next.project, next.status, next.objective, next.updated_at, expId);
    return this.get(expId);
  },
  remove(expId) {
    return db.prepare('DELETE FROM experiments WHERE id = ?').run(expId).changes > 0;
  }
};

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */
export const Entries = {
  create(expId, { type = 'note', author = 'Unknown', role = '', text, imageUrl = null }) {
    const _id = id(), t = now();
    const fp = fingerprint(text + t);
    db.prepare(`INSERT INTO entries (id,experiment_id,type,author,role,text,image_url,hash,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(_id, expId, type, author, role, text, imageUrl, fp, t);
    db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(t, expId);
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(_id);
  },
  get(entryId) {
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
  },
  sign(entryId, { by, role }) {
    const en = this.get(entryId);
    if (!en) return null;
    if (en.signed_by) return en; // already signed — immutable
    const t = now();
    const sig = fingerprint(en.text + by + t);
    db.prepare('UPDATE entries SET signed_by=?, signed_role=?, signed_at=?, sig=? WHERE id=?')
      .run(by, role, t, sig, entryId);
    return this.get(entryId);
  }
};

/* ------------------------------------------------------------------ */
/* Plans (experiment planner)                                          */
/* ------------------------------------------------------------------ */
const parsePlan = p => p && ({
  ...p,
  variables: JSON.parse(p.variables || '[]'),
  steps: JSON.parse(p.steps || '[]'),
  materials: JSON.parse(p.materials || '[]')
});

export const Plans = {
  list() {
    return db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all().map(parsePlan);
  },
  get(planId) {
    return parsePlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(planId));
  },
  create(data) {
    const _id = id(), t = now();
    const row = {
      title: data.title, hypothesis: data.hypothesis || '',
      variables: JSON.stringify(data.variables || []),
      steps: JSON.stringify(data.steps || []),
      materials: JSON.stringify(data.materials || []),
      expected_outcome: data.expected_outcome || '',
      status: data.status || 'draft',
      experiment_id: data.experiment_id || null
    };
    db.prepare(`INSERT INTO plans (id,experiment_id,title,hypothesis,variables,steps,materials,expected_outcome,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(_id, row.experiment_id, row.title, row.hypothesis, row.variables, row.steps, row.materials, row.expected_outcome, row.status, t, t);
    return this.get(_id);
  },
  update(planId, data) {
    const p = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    if (!p) return null;
    const merged = {
      title: data.title ?? p.title,
      hypothesis: data.hypothesis ?? p.hypothesis,
      variables: JSON.stringify(data.variables ?? JSON.parse(p.variables || '[]')),
      steps: JSON.stringify(data.steps ?? JSON.parse(p.steps || '[]')),
      materials: JSON.stringify(data.materials ?? JSON.parse(p.materials || '[]')),
      expected_outcome: data.expected_outcome ?? p.expected_outcome,
      status: data.status ?? p.status,
      experiment_id: data.experiment_id ?? p.experiment_id
    };
    db.prepare(`UPDATE plans SET title=?,hypothesis=?,variables=?,steps=?,materials=?,expected_outcome=?,status=?,experiment_id=?,updated_at=? WHERE id=?`)
      .run(merged.title, merged.hypothesis, merged.variables, merged.steps, merged.materials, merged.expected_outcome, merged.status, merged.experiment_id, now(), planId);
    return this.get(planId);
  },
  remove(planId) {
    return db.prepare('DELETE FROM plans WHERE id = ?').run(planId).changes > 0;
  }
};

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */
export const Inventory = {
  list() {
    return db.prepare('SELECT * FROM inventory ORDER BY name COLLATE NOCASE ASC').all();
  },
  get(itemId) {
    return db.prepare('SELECT * FROM inventory WHERE id = ?').get(itemId);
  },
  create(d) {
    const _id = id(), t = now();
    db.prepare(`INSERT INTO inventory (id,name,category,catalog_number,lot_number,location,quantity,unit,reorder_level,expiry_date,notes,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(_id, d.name, d.category || '', d.catalog_number || '', d.lot_number || '', d.location || '',
           Number(d.quantity) || 0, d.unit || '', Number(d.reorder_level) || 0, d.expiry_date || null, d.notes || '', t, t);
    return this.get(_id);
  },
  update(itemId, d) {
    const it = this.get(itemId);
    if (!it) return null;
    const n = {
      name: d.name ?? it.name, category: d.category ?? it.category,
      catalog_number: d.catalog_number ?? it.catalog_number, lot_number: d.lot_number ?? it.lot_number,
      location: d.location ?? it.location,
      quantity: d.quantity != null ? Number(d.quantity) : it.quantity,
      unit: d.unit ?? it.unit,
      reorder_level: d.reorder_level != null ? Number(d.reorder_level) : it.reorder_level,
      expiry_date: d.expiry_date ?? it.expiry_date, notes: d.notes ?? it.notes
    };
    db.prepare(`UPDATE inventory SET name=?,category=?,catalog_number=?,lot_number=?,location=?,quantity=?,unit=?,reorder_level=?,expiry_date=?,notes=?,updated_at=? WHERE id=?`)
      .run(n.name, n.category, n.catalog_number, n.lot_number, n.location, n.quantity, n.unit, n.reorder_level, n.expiry_date, n.notes, now(), itemId);
    return this.get(itemId);
  },
  /** Adjust stock by a delta (negative = consume). Returns updated item. */
  adjust(itemId, delta) {
    const it = this.get(itemId);
    if (!it) return null;
    const q = Math.max(0, (Number(it.quantity) || 0) + Number(delta));
    db.prepare('UPDATE inventory SET quantity=?, updated_at=? WHERE id=?').run(q, now(), itemId);
    return this.get(itemId);
  },
  remove(itemId) {
    return db.prepare('DELETE FROM inventory WHERE id = ?').run(itemId).changes > 0;
  }
};

export function isEmpty() {
  return db.prepare('SELECT COUNT(*) n FROM experiments').get().n === 0
      && db.prepare('SELECT COUNT(*) n FROM inventory').get().n === 0;
}
