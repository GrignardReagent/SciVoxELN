import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('entry revisions preserve previous text and export with edited records', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-entry-revisions-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-entry-revisions',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?entry-revisions=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'revision.scientist@biotech.test',
      name: 'Revision Scientist',
      password: 'revision-pass-123'
    });

    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Revision traceability run',
      objective: 'Keep prior notebook entry versions available after edits.'
    });
    const original = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Initial observation: cells at 80% confluence before treatment.'
    });

    const updated = await scientist.req(base, 'PATCH', `/api/entries/${original.id}`, {
      text: 'Updated observation: cells at 85% confluence before treatment.'
    });
    assert.equal(updated.id, original.id);
    assert.notEqual(updated.hash, original.hash);
    assert.equal(updated.revision_count, 1);

    const revisions = await scientist.req(base, 'GET', `/api/entries/${original.id}/revisions`);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].entry_id, original.id);
    assert.equal(revisions[0].revision_no, 1);
    assert.equal(revisions[0].previous_text, original.text);
    assert.equal(revisions[0].previous_hash, original.hash);
    assert.equal(revisions[0].edited_by, 'Revision Scientist');
    assert.match(revisions[0].created_at, /^\d{4}-\d{2}-\d{2}T/);

    const refreshed = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    const refreshedEntry = refreshed.entries.find(en => en.id === original.id);
    assert.equal(refreshedEntry.revision_count, 1);

    const exported = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/export`);
    const exportedEntry = exported.experiment.entries.find(en => en.id === original.id);
    assert.equal(exportedEntry.revisions.length, 1);
    assert.equal(exportedEntry.revisions[0].previous_text, original.text);
    assert.equal(exportedEntry.revisions[0].previous_hash, original.hash);
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

test('migration adds entry revision storage to legacy databases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-entry-revisions-legacy-'));
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
    const dbModule = await import(`../src/db.js?entry-revisions-migration=${Date.now()}`);
    dbModule.migrate();
    const upgraded = new DatabaseSync(dbPath);
    assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entry_revisions'").get());
    assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_entry_revisions_entry'").get());
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
