import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('experiments get immutable searchable ELN record identifiers', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-experiment-identifiers-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-experiment-identifiers',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?experiment-identifiers=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'identifier.scientist@biotech.test',
      name: 'Identifier Scientist',
      password: 'identifier-pass-123'
    });

    const first = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'ELN identifier first run',
      objective: 'Make this record findable outside the app.'
    });
    const second = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'ELN identifier second run',
      objective: 'Ensure identifiers increment and remain unique.'
    });
    assert.match(first.eln_id, /^SVX-\d{8}-\d{4}$/);
    assert.match(second.eln_id, /^SVX-\d{8}-\d{4}$/);
    assert.notEqual(first.eln_id, second.eln_id);

    const edited = await scientist.req(base, 'PATCH', `/api/experiments/${first.id}`, {
      title: 'ELN identifier edited title',
      eln_id: 'SVX-20990101-9999'
    });
    assert.equal(edited.eln_id, first.eln_id);

    const list = await scientist.req(base, 'GET', '/api/experiments');
    assert.equal(list.some(row => row.id === first.id && row.eln_id === first.eln_id), true);

    const search = await scientist.req(base, 'GET', `/api/search?q=${encodeURIComponent(first.eln_id)}`);
    assert.equal(search.experiments.some(row => row.id === first.id), true);

    const exported = await scientist.req(base, 'GET', `/api/experiments/${first.id}/export`);
    assert.equal(exported.experiment.eln_id, first.eln_id);

    const exportedHtml = await scientist.raw(base, 'GET', `/api/experiments/${first.id}/export?format=html`);
    assert.equal(exportedHtml.status, 200);
    assert.ok(exportedHtml.body.includes(Buffer.from(first.eln_id)));

    const exportedPdf = await scientist.raw(base, 'GET', `/api/experiments/${first.id}/export?format=pdf`);
    assert.equal(exportedPdf.status, 200);
    assert.ok(exportedPdf.body.includes(Buffer.from(first.eln_id)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

test('migration adds and backfills experiment ELN identifiers to legacy databases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-experiment-identifiers-legacy-'));
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
    INSERT INTO experiments (id,title,project,status,objective,created_at,updated_at)
      VALUES ('legacy-exp-1','Legacy identifier run','General','active','Backfill me','2026-06-01T09:00:00.000Z','2026-06-01T09:00:00.000Z');
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
    const dbModule = await import(`../src/db.js?identifier-migration=${Date.now()}`);
    dbModule.migrate();
    const upgraded = new DatabaseSync(dbPath);
    const cols = upgraded.prepare('PRAGMA table_info(experiments)').all().map(c => c.name);
    assert.ok(cols.includes('eln_id'));
    const row = upgraded.prepare('SELECT eln_id FROM experiments WHERE id=?').get('legacy-exp-1');
    assert.match(row.eln_id, /^SVX-20260601-\d{4}$/);
    const indexes = upgraded.prepare('PRAGMA index_list(experiments)').all().map(row => row.name);
    assert.ok(indexes.includes('idx_experiments_eln_id'));
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
    },
    async raw(base, method, route) {
      const res = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}) } });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) };
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
