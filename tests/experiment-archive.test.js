import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('experiment archive hides records by default and restores them without deleting history', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-experiment-archive-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-experiment-archive',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?experiment-archive=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    await admin.req(base, 'POST', '/api/auth/register', {
      email: 'archive.experiment.admin@biotech.test',
      name: 'Experiment Archive Admin',
      password: 'archive-pass-123'
    });

    const exp = await admin.req(base, 'POST', '/api/experiments', {
      title: 'Archived assay run',
      objective: 'Keep an old run out of the default list without deleting it.'
    });
    const entry = await admin.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Original assay note remains part of the historical record.'
    });

    const defaultList = await admin.req(base, 'GET', '/api/experiments');
    assert.equal(defaultList.some(row => row.id === exp.id), true);

    const archived = await admin.req(base, 'POST', `/api/experiments/${exp.id}/archive`);
    assert.equal(archived.id, exp.id);
    assert.match(archived.archived_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(archived.archived_by, 'Experiment Archive Admin');

    const hiddenList = await admin.req(base, 'GET', '/api/experiments');
    assert.equal(hiddenList.some(row => row.id === exp.id), false);
    const allList = await admin.req(base, 'GET', '/api/experiments?includeArchived=true');
    assert.equal(allList.some(row => row.id === exp.id && row.archived_at), true);

    const direct = await admin.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(direct.entries.some(row => row.id === entry.id), true);
    assert.match(direct.archived_at, /^\d{4}-\d{2}-\d{2}T/);

    await assert.rejects(
      () => admin.req(base, 'PATCH', `/api/experiments/${exp.id}`, { objective: 'mutate archived run' }),
      /409 .*archived/i
    );
    await assert.rejects(
      () => admin.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'archived write' }),
      /409 .*archived/i
    );
    await assert.rejects(
      () => admin.req(base, 'POST', `/api/references`, { experimentId: exp.id, title: 'archived reference' }),
      /409 .*archived/i
    );

    const search = await admin.req(base, 'GET', '/api/search?q=Archived');
    assert.equal(search.experiments.some(row => row.id === exp.id), false);
    assert.equal(search.entries.some(row => row.id === entry.id), false);

    const restored = await admin.req(base, 'POST', `/api/experiments/${exp.id}/restore`);
    assert.equal(restored.id, exp.id);
    assert.equal(restored.archived_at, null);
    assert.equal(restored.archived_by, null);

    const visibleAgain = await admin.req(base, 'GET', '/api/experiments');
    assert.equal(visibleAgain.some(row => row.id === exp.id), true);
    const restoredEntry = await admin.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Restored experiment accepts new entries again.'
    });
    assert.equal(restoredEntry.experiment_id, exp.id);

    const audit = await admin.req(base, 'GET', '/api/audit');
    assert.equal(audit.some(row => row.action === 'ARCHIVE_EXPERIMENT' && row.detail.includes(exp.title)), true);
    assert.equal(audit.some(row => row.action === 'RESTORE_EXPERIMENT' && row.detail.includes(exp.title)), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

test('migration adds experiment archive columns to legacy databases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-experiment-archive-legacy-'));
  const dbPath = path.join(tmp, 'scivox.db');
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    DB_PATH: dbPath,
    SEED: 'false',
    NODE_NO_WARNINGS: '1'
  });
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user', password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local', provider_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE experiments (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', objective TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'note',
      author TEXT DEFAULT 'Unknown', role TEXT DEFAULT '', text TEXT NOT NULL,
      image_url TEXT, hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE audit (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, user TEXT DEFAULT 'Unknown',
      role TEXT DEFAULT '', action TEXT NOT NULL, detail TEXT DEFAULT ''
    );
  `);
  legacy.close();

  try {
    const dbModule = await import(`../src/db.js?experiment-archive-migration=${Date.now()}`);
    dbModule.migrate();
    const upgraded = new DatabaseSync(dbPath);
    const expCols = upgraded.prepare('PRAGMA table_info(experiments)').all().map(c => c.name);
    assert.ok(expCols.includes('archived_at'));
    assert.ok(expCols.includes('archived_by'));
    upgraded.close();
  } finally {
    restoreEnv(previousEnv);
  }
});

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function jar() {
  let cookie = '';
  return {
    async req(base, method, route, body) {
      const res = await fetch(base + route, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) throw new Error(`${res.status} ${data?.error || data}`);
      return data;
    }
  };
}

function snapshotEnv() {
  return {
    DATA_DIR: process.env.DATA_DIR,
    DB_PATH: process.env.DB_PATH,
    SEED: process.env.SEED,
    SESSION_SECRET: process.env.SESSION_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    SCIVOX_NO_LISTEN: process.env.SCIVOX_NO_LISTEN,
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS
  };
}

function restoreEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
