import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('admin can archive and restore users without deleting historical membership', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-user-archive-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-user-archive',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1',
    PASSWORD_RESET_EXPOSE_TOKEN: 'true'
  });
  const { app } = await import(`../src/index.js?archive=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();

    const adminUser = await admin.req(base, 'POST', '/api/auth/register', {
      email: 'admin.archive.test@biotech.test',
      name: 'Archive Admin',
      password: 'admin-pass-123'
    });
    const scientistUser = await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'archive.scientist@biotech.test',
      name: 'Archive Scientist',
      password: 'sci-pass-123'
    });

    const project = await admin.req(base, 'POST', '/api/projects', { name: 'Archive Pilot' });
    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: scientistUser.email,
      role: 'scientist'
    });

    await assert.rejects(
      () => admin.req(base, 'POST', `/api/users/${adminUser.id}/archive`),
      /409 .*your own account/i
    );

    const defaultUsers = await admin.req(base, 'GET', '/api/users');
    assert.ok(defaultUsers.some(u => u.id === scientistUser.id));

    const archived = await admin.req(base, 'POST', `/api/users/${scientistUser.id}/archive`);
    assert.equal(archived.id, scientistUser.id);
    assert.match(archived.archived_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(archived.archived_by, adminUser.id);

    const visibleUsers = await admin.req(base, 'GET', '/api/users');
    assert.equal(visibleUsers.some(u => u.id === scientistUser.id), false);
    const allUsers = await admin.req(base, 'GET', '/api/users?includeArchived=true');
    assert.ok(allUsers.some(u => u.id === scientistUser.id && u.archived_at));

    await assert.rejects(
      () => scientist.req(base, 'GET', '/api/experiments'),
      /401/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/auth/login', {
        email: scientistUser.email,
        password: 'sci-pass-123'
      }),
      /403 .*archived/i
    );

    const reset = await admin.req(base, 'POST', '/api/auth/password-reset', { email: scientistUser.email });
    assert.equal(reset.token, undefined);

    await assert.rejects(
      () => admin.req(base, 'PATCH', `/api/users/${scientistUser.id}/role`, { role: 'reviewer' }),
      /409 .*archived/i
    );
    await assert.rejects(
      () => admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
        email: scientistUser.email,
        role: 'viewer'
      }),
      /409 .*archived/i
    );

    const members = await admin.req(base, 'GET', `/api/projects/${project.id}/members`);
    const archivedMember = members.find(m => m.id === scientistUser.id);
    assert.ok(archivedMember);
    assert.match(archivedMember.archived_at, /^\d{4}-\d{2}-\d{2}T/);

    const restored = await admin.req(base, 'POST', `/api/users/${scientistUser.id}/restore`);
    assert.equal(restored.id, scientistUser.id);
    assert.equal(restored.archived_at, null);
    assert.equal(restored.archived_by, null);

    const restoredLogin = await scientist.req(base, 'POST', '/api/auth/login', {
      email: scientistUser.email,
      password: 'sci-pass-123'
    });
    assert.equal(restoredLogin.id, scientistUser.id);

    const audit = await admin.req(base, 'GET', '/api/audit');
    assert.ok(audit.some(a => a.action === 'ARCHIVE_USER' && a.detail.includes(scientistUser.email)));
    assert.ok(audit.some(a => a.action === 'RESTORE_USER' && a.detail.includes(scientistUser.email)));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('migration adds archive columns to legacy user tables', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-user-archive-migration-'));
  const dbPath = path.join(tmp, 'scivox.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user', password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local', provider_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.close();

  Object.assign(process.env, {
    DATA_DIR: tmp,
    DB_PATH: dbPath,
    NODE_NO_WARNINGS: '1'
  });
  const mod = await import(`../src/db.js?archiveMigration=${Date.now()}`);
  mod.migrate();
  mod.db.close();

  const upgraded = new DatabaseSync(dbPath);
  const cols = upgraded.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  assert.ok(cols.includes('archived_at'));
  assert.ok(cols.includes('archived_by'));
  upgraded.close();
});

function jar() {
  let cookie = '';
  return {
    async req(base, method, url, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      const data = text && (res.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : text;
      if (!res.ok) throw new Error(`${res.status} ${typeof data === 'string' ? data : data.error || res.statusText}`);
      return data;
    }
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}
