import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

test('experiment custom metadata persists through templates repeats exports and search', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-experiment-metadata-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-experiment-metadata',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?experiment-metadata=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'metadata-scientist@biotech.test',
      name: 'Metadata Scientist',
      password: 'metadata-pass-123'
    });

    const initialMetadata = {
      extra_fields: {
        'Cell line': { type: 'text', value: 'HEK293', position: 1 },
        'Incubator CO2 (%)': { type: 'number', value: '5', unit: '%', position: 2 }
      }
    };
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'FAIR metadata run',
      objective: 'Capture structured metadata without cluttering the notebook.',
      metadata: initialMetadata
    });
    assert.deepEqual(exp.metadata, initialMetadata);

    const updatedMetadata = {
      extra_fields: {
        ...initialMetadata.extra_fields,
        'Assay readout': { type: 'text', value: 'luminescence', position: 3 }
      }
    };
    const updated = await scientist.req(base, 'PATCH', `/api/experiments/${exp.id}`, { metadata: updatedMetadata });
    assert.deepEqual(updated.metadata, updatedMetadata);

    const template = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/template`, { name: 'FAIR metadata template' });
    assert.deepEqual(template.metadata, updatedMetadata);
    const fromTemplate = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'FAIR metadata templated follow-up',
      template_id: template.id
    });
    assert.deepEqual(fromTemplate.metadata, updatedMetadata);

    const repeated = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/duplicate`, {
      title: 'FAIR metadata repeat'
    });
    assert.deepEqual(repeated.metadata, updatedMetadata);

    const exported = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/export`);
    assert.deepEqual(exported.experiment.metadata, updatedMetadata);

    const search = await scientist.req(base, 'GET', '/api/search?q=luminescence');
    assert.equal(search.experiments.some(row => row.id === exp.id), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

test('migration adds experiment metadata columns to legacy databases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-metadata-legacy-'));
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
    const dbModule = await import(`../src/db.js?metadata-migration=${Date.now()}`);
    dbModule.migrate();
    const upgraded = new DatabaseSync(dbPath);
    const expCols = upgraded.prepare('PRAGMA table_info(experiments)').all().map(c => c.name);
    const templateCols = upgraded.prepare('PRAGMA table_info(experiment_templates)').all().map(c => c.name);
    assert.ok(expCols.includes('metadata'));
    assert.ok(templateCols.includes('metadata'));
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
