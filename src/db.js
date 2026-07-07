/**
 * Data-access layer for SciVox ELN.
 *
 * All SQL stays in this module. Routes call repository objects only, so the
 * pilot SQLite store can later be swapped for Postgres by re-implementing this
 * file without disturbing route handlers or the vanilla frontend.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'scivox.db');

export const db = new DatabaseSync(DB_PATH);
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch {
  try { db.exec('PRAGMA journal_mode = DELETE;'); } catch { /* keep default */ }
}
db.exec('PRAGMA foreign_keys = ON;');

const now = () => new Date().toISOString();
const id = () => randomUUID();
const DEFAULT_ORG_SLUG = 'default';
const DEFAULT_PROJECT_SLUG = 'general-r-and-d';
export const HIDDEN_ENTRY_TYPES = new Set(['voice_transcript']);

export const PROJECT_ROLES = { viewer: 1, scientist: 2, reviewer: 3, owner: 4 };

/** SHA-256 content fingerprint for entries, signatures, exports and audit rows. */
export function fingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function addColumn(table, column, ddl) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cleanEntryIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))).slice(0, 40);
}

export function isHiddenEntryType(type) {
  return HIDDEN_ENTRY_TYPES.has(String(type || ''));
}

/* ------------------------------------------------------------------ */
/* Schema and idempotent migrations                                    */
/* ------------------------------------------------------------------ */
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      email             TEXT UNIQUE,
      name              TEXT NOT NULL DEFAULT '',
      role              TEXT NOT NULL DEFAULT 'user',
      password_hash     TEXT,
      provider          TEXT NOT NULL DEFAULT 'local',
      provider_id       TEXT,
      email_verified_at TEXT,
      archived_at       TEXT,
      archived_by       TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id)
      WHERE provider_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS orgs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE(org_id, slug)
    );

    CREATE TABLE IF NOT EXISTS memberships (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'scientist',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT DEFAULT '',
      ip         TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id          TEXT PRIMARY KEY,
      project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      project     TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',
      objective   TEXT DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id                TEXT PRIMARY KEY,
      experiment_id     TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      type              TEXT NOT NULL DEFAULT 'note',
      author            TEXT DEFAULT 'Unknown',
      role              TEXT DEFAULT '',
      text              TEXT NOT NULL,
      image_url         TEXT,
      raw_image_url     TEXT,
      clean_image_url   TEXT,
      hash              TEXT NOT NULL,
      source_entry_ids  TEXT DEFAULT '[]',
      signed_by         TEXT,
      signed_role       TEXT,
      signed_at         TEXT,
      sig               TEXT,
      signature_meaning TEXT,
      deleted_at        TEXT,
      deleted_by        TEXT,
      delete_reason     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_entries_exp ON entries(experiment_id);

    CREATE TABLE IF NOT EXISTS plans (
      id               TEXT PRIMARY KEY,
      project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
      experiment_id    TEXT REFERENCES experiments(id) ON DELETE SET NULL,
      title            TEXT NOT NULL,
      hypothesis       TEXT DEFAULT '',
      variables        TEXT DEFAULT '[]',
      steps            TEXT DEFAULT '[]',
      materials        TEXT DEFAULT '[]',
      expected_outcome TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'draft',
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
      id            TEXT PRIMARY KEY,
      ts            TEXT NOT NULL,
      user          TEXT DEFAULT 'Unknown',
      role          TEXT DEFAULT '',
      action        TEXT NOT NULL,
      detail        TEXT DEFAULT '',
      project_id    TEXT,
      previous_hash TEXT DEFAULT '',
      hash          TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);

    CREATE TABLE IF NOT EXISTS experiment_exports (
      id            TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      created_by    TEXT DEFAULT '',
      created_at    TEXT NOT NULL,
      format        TEXT NOT NULL DEFAULT 'json',
      hash          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_refs (
      id            TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      authors       TEXT DEFAULT '',
      year          TEXT DEFAULT '',
      doi           TEXT DEFAULT '',
      url           TEXT DEFAULT '',
      source        TEXT NOT NULL DEFAULT 'manual',
      external_id   TEXT DEFAULT '',
      created_at    TEXT NOT NULL,
      created_by    TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_refs_exp ON paper_refs(experiment_id);
  `);

  addColumn('users', 'email_verified_at', 'TEXT');
  addColumn('users', 'archived_at', 'TEXT');
  addColumn('users', 'archived_by', 'TEXT');
  addColumn('experiments', 'project_id', 'TEXT');
  addColumn('entries', 'signature_meaning', 'TEXT');
  addColumn('entries', 'deleted_at', 'TEXT');
  addColumn('entries', 'deleted_by', 'TEXT');
  addColumn('entries', 'delete_reason', 'TEXT');
  addColumn('entries', 'source_entry_ids', "TEXT DEFAULT '[]'");
  addColumn('entries', 'updated_at', 'TEXT');
  addColumn('entries', 'raw_image_url', 'TEXT');
  addColumn('entries', 'clean_image_url', 'TEXT');
  addColumn('plans', 'project_id', 'TEXT');
  addColumn('audit', 'project_id', 'TEXT');
  addColumn('audit', 'previous_hash', "TEXT DEFAULT ''");
  addColumn('audit', 'hash', "TEXT DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_project ON audit(project_id);');

  ensureDefaultWorkspace();
  backfillLegacyHashes();
}

function ensureDefaultWorkspace() {
  const t = now();
  let org = db.prepare('SELECT * FROM orgs WHERE slug = ?').get(DEFAULT_ORG_SLUG);
  if (!org) {
    const orgId = id();
    db.prepare('INSERT INTO orgs (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(orgId, 'SciVox Workspace', DEFAULT_ORG_SLUG, t, t);
    org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(orgId);
  }

  let project = db.prepare('SELECT * FROM projects WHERE org_id = ? AND slug = ?').get(org.id, DEFAULT_PROJECT_SLUG);
  if (!project) {
    const projectId = id();
    db.prepare('INSERT INTO projects (id,org_id,name,slug,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(projectId, org.id, 'General R&D', DEFAULT_PROJECT_SLUG, 'Default project for pilot notebooks and migrated records.', t, t);
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  }

  db.prepare('UPDATE experiments SET project_id = ? WHERE project_id IS NULL OR project_id = ?').run(project.id, '');
  db.prepare('UPDATE plans SET project_id = ? WHERE project_id IS NULL OR project_id = ?').run(project.id, '');

  for (const user of db.prepare('SELECT id, role FROM users').all()) {
    const role = user.role === 'admin' ? 'owner' : 'scientist';
    db.prepare(`INSERT OR IGNORE INTO memberships (user_id,project_id,role,created_at,updated_at)
                VALUES (?,?,?,?,?)`).run(user.id, project.id, role, t, t);
  }
}

function backfillLegacyHashes() {
  const rows = db.prepare("SELECT * FROM audit WHERE hash IS NULL OR hash = '' ORDER BY ts ASC").all();
  let previous = db.prepare("SELECT hash FROM audit WHERE hash IS NOT NULL AND hash != '' ORDER BY ts DESC LIMIT 1").get()?.hash || '';
  for (const row of rows) {
    const hash = fingerprint(JSON.stringify({
      id: row.id, ts: row.ts, user: row.user, role: row.role,
      action: row.action, detail: row.detail, project_id: row.project_id || null,
      previous_hash: previous
    }));
    db.prepare('UPDATE audit SET previous_hash=?, hash=? WHERE id=?').run(previous, hash, row.id);
    previous = hash;
  }
}

/* ------------------------------------------------------------------ */
/* Users, sessions and account recovery                                */
/* ------------------------------------------------------------------ */
const publicUser = u => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, provider: u.provider,
  email_verified_at: u.email_verified_at, archived_at: u.archived_at || null,
  archived_by: u.archived_by || null, created_at: u.created_at
});

export const Users = {
  count() { return db.prepare('SELECT COUNT(*) n FROM users').get().n; },
  list({ includeArchived = false } = {}) {
    const where = includeArchived ? '' : 'WHERE archived_at IS NULL';
    return db.prepare(`SELECT * FROM users ${where} ORDER BY created_at ASC`).all().map(publicUser);
  },
  getById(uid) { return db.prepare('SELECT * FROM users WHERE id = ?').get(uid); },
  getByEmail(email) { return email ? db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null; },
  getByProvider(provider, providerId) {
    return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId);
  },
  create({ email = null, name = '', role = 'user', passwordHash = null, provider = 'local', providerId = null }) {
    const _id = id(), t = now();
    db.prepare(`INSERT INTO users (id,email,name,role,password_hash,provider,provider_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(_id, email, name, role, passwordHash, provider, providerId, t, t);
    Projects.addDefaultMembership(_id, role === 'admin' ? 'owner' : 'scientist');
    return this.getById(_id);
  },
  setRole(uid, role) {
    db.prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').run(role, now(), uid);
    return publicUser(this.getById(uid));
  },
  archive(uid, archivedBy) {
    db.prepare('UPDATE users SET archived_at=?, archived_by=?, updated_at=? WHERE id=? AND archived_at IS NULL')
      .run(now(), archivedBy || null, now(), uid);
    return publicUser(this.getById(uid));
  },
  restore(uid) {
    db.prepare('UPDATE users SET archived_at=NULL, archived_by=NULL, updated_at=? WHERE id=?')
      .run(now(), uid);
    return publicUser(this.getById(uid));
  },
  setPassword(uid, passwordHash) {
    db.prepare("UPDATE users SET password_hash=?, provider='local', updated_at=? WHERE id=?").run(passwordHash, now(), uid);
    return this.getById(uid);
  },
  markEmailVerified(uid) {
    db.prepare('UPDATE users SET email_verified_at=?, updated_at=? WHERE id=?').run(now(), now(), uid);
    return this.getById(uid);
  },
  countAdmins() { return db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND archived_at IS NULL").get().n; },
  public: publicUser
};

export const Sessions = {
  create({ id: sid, userId, tokenHash, expiresAt, userAgent = '', ip = '' }) {
    db.prepare(`INSERT INTO sessions (id,user_id,token_hash,user_agent,ip,created_at,expires_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(sid, userId, tokenHash, String(userAgent || '').slice(0, 500), String(ip || '').slice(0, 120), now(), expiresAt);
  },
  getValid(sid, tokenHash) {
    return db.prepare(`SELECT * FROM sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at > ?`).get(sid, tokenHash, now());
  },
  revoke(sid, tokenHash = null) {
    const t = now();
    if (tokenHash) return db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND token_hash=? AND revoked_at IS NULL').run(t, sid, tokenHash).changes;
    return db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(t, sid).changes;
  },
  revokeUser(userId) {
    return db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), userId).changes;
  },
  listByUser(userId) {
    return db.prepare('SELECT id,user_agent,ip,created_at,expires_at,revoked_at FROM sessions WHERE user_id=? ORDER BY created_at DESC').all(userId);
  }
};

function issueExpiringToken(table, userId, minutes = 60) {
  const token = randomToken();
  const expires = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare(`INSERT INTO ${table} (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`)
    .run(fingerprint(token), userId, now(), expires);
  return { token, expires_at: expires };
}

function consumeExpiringToken(table, token) {
  const hash = fingerprint(token);
  const row = db.prepare(`SELECT * FROM ${table}
    WHERE token_hash=? AND used_at IS NULL AND expires_at > ?`).get(hash, now());
  if (!row) return null;
  db.prepare(`UPDATE ${table} SET used_at=? WHERE token_hash=?`).run(now(), hash);
  return row;
}

export const PasswordResets = {
  issue(userId) { return issueExpiringToken('password_reset_tokens', userId, 60); },
  consume(token) { return consumeExpiringToken('password_reset_tokens', token); }
};

export const EmailVerifications = {
  issue(userId) { return issueExpiringToken('email_verifications', userId, 24 * 60); },
  consume(token) { return consumeExpiringToken('email_verifications', token); }
};

/* ------------------------------------------------------------------ */
/* Organisations, projects and memberships                             */
/* ------------------------------------------------------------------ */
function projectRoleRank(role) { return PROJECT_ROLES[role] || 0; }

export const Orgs = {
  list(user) {
    if (user?.role === 'admin') return db.prepare('SELECT * FROM orgs ORDER BY name COLLATE NOCASE').all();
    return db.prepare(`SELECT DISTINCT o.* FROM orgs o
      JOIN projects p ON p.org_id=o.id JOIN memberships m ON m.project_id=p.id
      WHERE m.user_id=? ORDER BY o.name COLLATE NOCASE`).all(user?.id || '');
  },
  create({ name, slug }) {
    const _id = id(), t = now();
    const cleanSlug = slugify(slug || name);
    db.prepare('INSERT INTO orgs (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(_id, name, cleanSlug, t, t);
    return db.prepare('SELECT * FROM orgs WHERE id=?').get(_id);
  }
};

export const Projects = {
  defaultProjectId() {
    ensureDefaultWorkspace();
    return db.prepare(`SELECT p.id FROM projects p JOIN orgs o ON o.id=p.org_id
      WHERE o.slug=? AND p.slug=?`).get(DEFAULT_ORG_SLUG, DEFAULT_PROJECT_SLUG).id;
  },
  list(user) {
    const sql = `SELECT p.*, o.name AS org_name,
      (SELECT COUNT(*) FROM experiments e WHERE e.project_id=p.id) AS experiment_count,
      (SELECT COUNT(*) FROM memberships m WHERE m.project_id=p.id) AS member_count
      FROM projects p JOIN orgs o ON o.id=p.org_id`;
    if (user?.role === 'admin') return db.prepare(`${sql} ORDER BY o.name COLLATE NOCASE, p.name COLLATE NOCASE`).all();
    return db.prepare(`${sql} JOIN memberships m ON m.project_id=p.id
      WHERE m.user_id=? ORDER BY o.name COLLATE NOCASE, p.name COLLATE NOCASE`).all(user?.id || '');
  },
  get(projectId) {
    return db.prepare(`SELECT p.*, o.name AS org_name FROM projects p
      JOIN orgs o ON o.id=p.org_id WHERE p.id=?`).get(projectId);
  },
  create({ org_id, name, slug = '', description = '' }) {
    const _id = id(), t = now();
    const orgId = org_id || db.prepare('SELECT id FROM orgs WHERE slug=?').get(DEFAULT_ORG_SLUG)?.id;
    db.prepare('INSERT INTO projects (id,org_id,name,slug,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(_id, orgId, name, slugify(slug || name), description, t, t);
    return this.get(_id);
  },
  members(projectId) {
    return db.prepare(`SELECT m.project_id,m.role,m.created_at,m.updated_at,u.id,u.email,u.name,u.provider,u.archived_at,u.archived_by,u.created_at AS user_created_at
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=?
      ORDER BY u.name COLLATE NOCASE, u.email COLLATE NOCASE`).all(projectId);
  },
  membership(userId, projectId) {
    return db.prepare('SELECT * FROM memberships WHERE user_id=? AND project_id=?').get(userId, projectId);
  },
  addDefaultMembership(userId, role = 'scientist') {
    const projectId = this.defaultProjectId();
    return this.setMember(projectId, userId, role);
  },
  setMember(projectId, userId, role = 'scientist') {
    if (!PROJECT_ROLES[role]) throw new Error('Invalid project role');
    const t = now();
    db.prepare(`INSERT INTO memberships (user_id,project_id,role,created_at,updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,project_id) DO UPDATE SET role=excluded.role, updated_at=excluded.updated_at`)
      .run(userId, projectId, role, t, t);
    return this.membership(userId, projectId);
  },
  removeMember(projectId, userId) {
    return db.prepare('DELETE FROM memberships WHERE user_id=? AND project_id=?').run(userId, projectId).changes > 0;
  },
  idsForUser(user) {
    if (!user) return [];
    if (user.role === 'admin') return db.prepare('SELECT id FROM projects').all().map(r => r.id);
    return db.prepare('SELECT project_id FROM memberships WHERE user_id=?').all(user.id).map(r => r.project_id);
  },
  canAccessProject(user, projectId, minRole = 'viewer') {
    if (!user || !projectId) return false;
    if (user.role === 'admin') return true;
    const m = this.membership(user.id, projectId);
    return !!m && projectRoleRank(m.role) >= projectRoleRank(minRole);
  }
};

function slugify(value) {
  return String(value || 'item').toLowerCase().trim()
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */
export const Audit = {
  log(user, role, action, detail = '', opts = {}) {
    const _id = id(), t = now();
    const previous = db.prepare("SELECT hash FROM audit WHERE hash IS NOT NULL AND hash != '' ORDER BY ts DESC LIMIT 1").get()?.hash || '';
    const projectId = opts.projectId || opts.project_id || null;
    const payload = JSON.stringify({ id: _id, ts: t, user: user || 'Unknown', role: role || '', action, detail, project_id: projectId, previous_hash: previous });
    const hash = fingerprint(payload);
    db.prepare(`INSERT INTO audit (id,ts,user,role,action,detail,project_id,previous_hash,hash)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(_id, t, user || 'Unknown', role || '', action, detail, projectId, previous, hash);
    return { id: _id, ts: t, hash, previous_hash: previous };
  },
  list(filters = {}) {
    const limit = Math.min(Number(filters.limit) || 1000, 10000);
    const where = [];
    const args = [];
    if (filters.project) { where.push('(project_id = ? OR detail LIKE ?)'); args.push(filters.project, `%${filters.project}%`); }
    if (filters.user) { where.push('(user LIKE ? OR detail LIKE ?)'); args.push(`%${filters.user}%`, `%${filters.user}%`); }
    if (filters.action) { where.push('action = ?'); args.push(filters.action); }
    if (filters.from) { where.push('ts >= ?'); args.push(filters.from); }
    if (filters.to) { where.push('ts <= ?'); args.push(filters.to); }
    if (Array.isArray(filters.projectIds)) {
      if (!filters.projectIds.length) where.push('project_id IS NULL AND 1=0');
      else { where.push(`(project_id IN (${placeholders(filters.projectIds)})${filters.includeGlobal ? ' OR project_id IS NULL' : ''})`); args.push(...filters.projectIds); }
    }
    const sql = `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`;
    return db.prepare(sql).all(...args, limit);
  }
};

/* ------------------------------------------------------------------ */
/* Experiments and entries                                             */
/* ------------------------------------------------------------------ */
function withProjectRows(base, user, order = 'e.created_at DESC') {
  const select = `SELECT e.*, p.name AS project_name, p.org_id AS org_id, o.name AS org_name,
    (SELECT COUNT(*) FROM entries en WHERE en.experiment_id=e.id AND en.deleted_at IS NULL AND en.type NOT IN ('voice_transcript')) AS entryCount
    FROM experiments e LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN orgs o ON o.id=p.org_id`;
  if (user?.role === 'admin') return db.prepare(`${select} ${base} ORDER BY ${order}`).all();
  const ids = Projects.idsForUser(user);
  if (!ids.length) return [];
  const where = `${base ? base + ' AND' : 'WHERE'} e.project_id IN (${placeholders(ids)})`;
  return db.prepare(`${select} ${where} ORDER BY ${order}`).all(...ids);
}

export const Experiments = {
  list(user = null) {
    return withProjectRows('', user);
  },
  get(expId, user = null) {
    const exp = db.prepare(`SELECT e.*, p.name AS project_name, o.name AS org_name
      FROM experiments e LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN orgs o ON o.id=p.org_id
      WHERE e.id = ?`).get(expId);
    if (!exp) return null;
    if (user && !Projects.canAccessProject(user, exp.project_id, 'viewer')) return null;
    exp.entries = db.prepare('SELECT * FROM entries WHERE experiment_id = ? AND deleted_at IS NULL ORDER BY created_at ASC').all(expId);
    return exp;
  },
  create({ title, project = '', objective = '', status = 'active', project_id = null }) {
    const _id = id(), t = now();
    const projectId = project_id || Projects.defaultProjectId();
    const projectName = project || Projects.get(projectId)?.name || '';
    db.prepare('INSERT INTO experiments (id,project_id,title,project,status,objective,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(_id, projectId, title, projectName, status, objective, t, t);
    return this.get(_id);
  },
  update(expId, fields) {
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(expId);
    if (!exp) return null;
    const nextProjectId = fields.project_id ?? exp.project_id;
    const nextProjectName = fields.project ?? (nextProjectId !== exp.project_id ? Projects.get(nextProjectId)?.name || exp.project : exp.project);
    const next = { ...exp, ...fields, project_id: nextProjectId, project: nextProjectName, updated_at: now() };
    db.prepare('UPDATE experiments SET project_id=?,title=?,project=?,status=?,objective=?,updated_at=? WHERE id=?')
      .run(next.project_id, next.title, next.project, next.status, next.objective, next.updated_at, expId);
    return this.get(expId);
  },
  remove(expId) {
    return db.prepare('DELETE FROM experiments WHERE id = ?').run(expId).changes > 0;
  },
  canAccess(user, expId, minProjectRole = 'viewer') {
    const exp = db.prepare('SELECT project_id FROM experiments WHERE id=?').get(expId);
    return !!exp && Projects.canAccessProject(user, exp.project_id, minProjectRole);
  }
};

export const Entries = {
  list(user = null) {
    const select = `SELECT en.*, e.title AS experiment_title, e.status AS experiment_status,
      e.project_id, p.name AS project_name, o.name AS org_name
      FROM entries en
      JOIN experiments e ON e.id=en.experiment_id
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN orgs o ON o.id=p.org_id
      WHERE en.deleted_at IS NULL AND en.type NOT IN ('voice_transcript')`;
    if (user?.role === 'admin') return db.prepare(`${select} ORDER BY en.created_at DESC`).all();
    const ids = Projects.idsForUser(user);
    if (!ids.length) return [];
    return db.prepare(`${select} AND e.project_id IN (${placeholders(ids)}) ORDER BY en.created_at DESC`).all(...ids);
  },
  create(expId, {
    type = 'note',
    author = 'Unknown',
    role = '',
    text,
    imageUrl = null,
    rawImageUrl = null,
    cleanImageUrl = null,
    sourceEntryIds = []
  }) {
    const _id = id(), t = now();
    const sources = cleanEntryIds(sourceEntryIds);
    const fp = fingerprint(JSON.stringify({
      experiment_id: expId, type, text, image_url: imageUrl || null,
      raw_image_url: rawImageUrl || null, clean_image_url: cleanImageUrl || null,
      source_entry_ids: sources,
      created_at: t
    }));
    db.prepare(`INSERT INTO entries (id,experiment_id,type,author,role,text,image_url,raw_image_url,clean_image_url,hash,source_entry_ids,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(_id, expId, type, author, role, text, imageUrl, rawImageUrl, cleanImageUrl, fp, JSON.stringify(sources), t, t);
    db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(t, expId);
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(_id);
  },
  get(entryId) {
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
  },
  getDetailed(entryId, user = null) {
    const row = db.prepare(`SELECT en.*, e.title AS experiment_title, e.status AS experiment_status,
      e.objective AS experiment_objective, e.project_id, p.name AS project_name, o.name AS org_name
      FROM entries en
      JOIN experiments e ON e.id=en.experiment_id
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN orgs o ON o.id=p.org_id
      WHERE en.id=? AND en.deleted_at IS NULL`).get(entryId);
    if (!row) return null;
    if (user && !Projects.canAccessProject(user, row.project_id, 'viewer')) return null;
    return row;
  },
  getManyDetailed(entryIds, user = null) {
    const ids = Array.from(new Set((entryIds || []).map(String).filter(Boolean))).slice(0, 40);
    if (!ids.length) return [];
    const rows = db.prepare(`SELECT en.*, e.title AS experiment_title, e.status AS experiment_status,
      e.objective AS experiment_objective, e.project_id, p.name AS project_name, o.name AS org_name
      FROM entries en
      JOIN experiments e ON e.id=en.experiment_id
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN orgs o ON o.id=p.org_id
      WHERE en.id IN (${placeholders(ids)}) AND en.deleted_at IS NULL
      ORDER BY en.created_at ASC`).all(...ids);
    return user ? rows.filter(row => Projects.canAccessProject(user, row.project_id, 'viewer')) : rows;
  },
  update(entryId, { text }) {
    const en = this.get(entryId);
    if (!en || en.deleted_at) return en || null;
    const t = now();
    const fp = fingerprint(JSON.stringify({
      experiment_id: en.experiment_id,
      type: en.type,
      text,
      image_url: en.image_url || null,
      raw_image_url: en.raw_image_url || null,
      clean_image_url: en.clean_image_url || null,
      source_entry_ids: parseJsonArray(en.source_entry_ids),
      created_at: en.created_at,
      updated_at: t
    }));
    db.prepare('UPDATE entries SET text=?, hash=?, updated_at=? WHERE id=?').run(text, fp, t, entryId);
    db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(t, en.experiment_id);
    return this.get(entryId);
  },
  sign(entryId, { by, role, meaning = 'author' }) {
    const en = this.get(entryId);
    if (!en) return null;
    if (en.signed_by) return en;
    const t = now();
    const sig = fingerprint(JSON.stringify({ entry_id: entryId, entry_hash: en.hash, by, role, meaning, signed_at: t }));
    db.prepare('UPDATE entries SET signed_by=?, signed_role=?, signed_at=?, sig=?, signature_meaning=? WHERE id=?')
      .run(by, role, t, sig, meaning, entryId);
    return this.get(entryId);
  },
  remove(entryId, { by = 'Unknown', reason = '' } = {}) {
    const en = this.get(entryId);
    if (!en || en.deleted_at) return en || null;
    const t = now();
    db.prepare('UPDATE entries SET deleted_at=?, deleted_by=?, delete_reason=? WHERE id=?')
      .run(t, by, reason, entryId);
    db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(t, en.experiment_id);
    return this.get(entryId);
  }
};

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */
export const Refs = {
  listByExperiment(expId) {
    return db.prepare('SELECT * FROM paper_refs WHERE experiment_id = ? ORDER BY created_at DESC').all(expId);
  },
  get(refId) { return db.prepare('SELECT * FROM paper_refs WHERE id = ?').get(refId); },
  findByDoi(expId, doi) {
    return doi ? db.prepare('SELECT * FROM paper_refs WHERE experiment_id = ? AND doi = ? COLLATE NOCASE').get(expId, doi) : null;
  },
  create(expId, d) {
    const _id = id(), t = now();
    db.prepare(`INSERT INTO paper_refs (id,experiment_id,title,authors,year,doi,url,source,external_id,created_at,created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(_id, expId, (d.title || 'Untitled reference').slice(0, 500), (d.authors || '').slice(0, 1000),
           String(d.year || '').slice(0, 12), (d.doi || '').slice(0, 200), (d.url || '').slice(0, 800),
           d.source || 'manual', (d.external_id || '').slice(0, 200), t, d.created_by || '');
    return this.get(_id);
  },
  remove(refId) { return db.prepare('DELETE FROM paper_refs WHERE id = ?').run(refId).changes > 0; }
};

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */
const parsePlan = p => p && ({
  ...p,
  variables: JSON.parse(p.variables || '[]'),
  steps: JSON.parse(p.steps || '[]'),
  materials: JSON.parse(p.materials || '[]')
});

export const Plans = {
  list(user = null) {
    const select = `SELECT pl.*, p.name AS project_name FROM plans pl LEFT JOIN projects p ON p.id=pl.project_id`;
    if (user?.role === 'admin') return db.prepare(`${select} ORDER BY pl.created_at DESC`).all().map(parsePlan);
    const ids = Projects.idsForUser(user);
    if (!ids.length) return [];
    return db.prepare(`${select} WHERE pl.project_id IN (${placeholders(ids)}) ORDER BY pl.created_at DESC`).all(...ids).map(parsePlan);
  },
  get(planId, user = null) {
    const plan = parsePlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(planId));
    if (!plan) return null;
    if (user && !Projects.canAccessProject(user, plan.project_id, 'viewer')) return null;
    return plan;
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
      experiment_id: data.experiment_id || null,
      project_id: data.project_id || Projects.defaultProjectId()
    };
    db.prepare(`INSERT INTO plans (id,project_id,experiment_id,title,hypothesis,variables,steps,materials,expected_outcome,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(_id, row.project_id, row.experiment_id, row.title, row.hypothesis, row.variables, row.steps, row.materials, row.expected_outcome, row.status, t, t);
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
      experiment_id: data.experiment_id ?? p.experiment_id,
      project_id: data.project_id ?? p.project_id
    };
    db.prepare(`UPDATE plans SET project_id=?,title=?,hypothesis=?,variables=?,steps=?,materials=?,expected_outcome=?,status=?,experiment_id=?,updated_at=? WHERE id=?`)
      .run(merged.project_id, merged.title, merged.hypothesis, merged.variables, merged.steps, merged.materials, merged.expected_outcome, merged.status, merged.experiment_id, now(), planId);
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

/* ------------------------------------------------------------------ */
/* Export evidence                                                     */
/* ------------------------------------------------------------------ */
export const ExperimentExports = {
  record(experimentId, { createdBy = '', format = 'json', hash }) {
    const _id = id();
    db.prepare('INSERT INTO experiment_exports (id,experiment_id,created_by,created_at,format,hash) VALUES (?,?,?,?,?,?)')
      .run(_id, experimentId, createdBy, now(), format, hash);
    return db.prepare('SELECT * FROM experiment_exports WHERE id=?').get(_id);
  },
  listByExperiment(experimentId) {
    return db.prepare('SELECT * FROM experiment_exports WHERE experiment_id=? ORDER BY created_at DESC').all(experimentId);
  }
};

/* ------------------------------------------------------------------ */
/* Smart search                                                        */
/* ------------------------------------------------------------------ */
export const Search = {
  smart(user, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { query: '', experiments: [], entries: [], references: [] };
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const expRows = Experiments.list(user);
    const experiments = expRows
      .map(e => ({ ...e, score: scoreText([e.title, e.project_name, e.project, e.objective].join(' '), terms, { title: e.title }) }))
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const ids = Projects.idsForUser(user);
    if (!ids.length) return { query: q, experiments, entries: [], references: [] };
    const expFilter = user?.role === 'admin' ? '' : `WHERE e.project_id IN (${placeholders(ids)})`;
    const args = user?.role === 'admin' ? [] : ids;

    const entryRows = db.prepare(`SELECT en.*, e.title AS experiment_title, e.project_id, p.name AS project_name
      FROM entries en JOIN experiments e ON e.id=en.experiment_id LEFT JOIN projects p ON p.id=e.project_id
      ${expFilter ? expFilter + ' AND' : 'WHERE'} en.deleted_at IS NULL AND en.type NOT IN ('voice_transcript')`).all(...args);
    const entries = entryRows
      .map(en => ({ ...en, score: scoreText([en.experiment_title, en.project_name, en.type, en.text].join(' '), terms, { title: en.experiment_title }) }))
      .filter(en => en.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const refRows = db.prepare(`SELECT r.*, e.title AS experiment_title, e.project_id, p.name AS project_name
      FROM paper_refs r JOIN experiments e ON e.id=r.experiment_id LEFT JOIN projects p ON p.id=e.project_id
      ${expFilter}`).all(...args);
    const references = refRows
      .map(r => ({ ...r, score: scoreText([r.title, r.authors, r.year, r.doi, r.experiment_title, r.project_name].join(' '), terms, { title: r.title }) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return { query: q, experiments, entries, references };
  }
};

function scoreText(text, terms, weights = {}) {
  const hay = String(text || '').toLowerCase();
  const title = String(weights.title || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 5;
    if (hay.includes(term)) score += 2;
    const count = hay.split(term).length - 1;
    score += Math.min(count, 6) * 0.5;
  }
  return score;
}

export function isEmpty() {
  return db.prepare('SELECT COUNT(*) n FROM experiments').get().n === 0
      && db.prepare('SELECT COUNT(*) n FROM inventory').get().n === 0;
}
