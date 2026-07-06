import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('MVP pilot workflow: projects, access, signatures, exports, audit and session revocation', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-mvp-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-mvp-api',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?mvp=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();

    const adminUser = await admin.req(base, 'POST', '/api/auth/register', {
      email: 'admin@biotech.test',
      name: 'Admin',
      password: 'admin-pass-123'
    });
    assert.equal(adminUser.role, 'admin');

    const project = await admin.req(base, 'POST', '/api/projects', {
      name: 'Pilot R&D',
      description: 'Access control pilot'
    });
    assert.ok(project.id);

    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'sci@biotech.test',
      name: 'Scientist',
      password: 'sci-pass-123'
    });

    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'viewer'
    });

    const exp = await admin.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'mRNA stability screen',
      objective: 'Assess stability after freeze-thaw.'
    });
    assert.equal(exp.project_id, project.id);

    const viewed = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(viewed.title, exp.title);
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'viewer cannot write' }),
      /403/
    );

    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'scientist'
    });

    const entry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Prepared formulation A and recorded visual clarity.'
    });
    assert.match(entry.hash, /^[a-f0-9]{64}$/);

    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${entry.id}/sign`, { meaning: 'author', password: 'wrong-password' }),
      /401/
    );

    const signed = await scientist.req(base, 'POST', `/api/entries/${entry.id}/sign`, {
      meaning: 'author',
      password: 'sci-pass-123'
    });
    assert.equal(signed.signature_meaning, 'author');
    assert.match(signed.sig, /^[a-f0-9]{64}$/);

    await admin.req(base, 'POST', `/api/experiments/${exp.id}/lock`);
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'after lock' }),
      /409/
    );

    const exported = await admin.req(base, 'GET', `/api/experiments/${exp.id}/export`);
    assert.equal(exported.experiment.id, exp.id);
    assert.match(exported.integrity.sha256, /^[a-f0-9]{64}$/);

    const audit = await admin.req(base, 'GET', `/api/audit?project=${project.id}`);
    assert.ok(audit.some(a => a.action === 'SIGN_ENTRY'));
    assert.ok(audit.every(a => a.hash && a.previous_hash != null));

    const search = await scientist.req(base, 'GET', '/api/search?q=formulation clarity');
    assert.ok(search.entries.some(e => e.id === entry.id));

    await scientist.req(base, 'POST', '/api/auth/sessions/revoke', {});
    await assert.rejects(() => scientist.req(base, 'GET', '/api/experiments'), /401/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('backup and restore scripts preserve the data directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-backup-src-'));
  const restore = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-backup-dst-'));
  fs.writeFileSync(path.join(tmp, 'scivox.db'), 'not-a-real-db-for-script-test');
  fs.mkdirSync(path.join(tmp, 'uploads'));
  fs.writeFileSync(path.join(tmp, 'uploads', 'scan.txt'), 'scan');

  const backup = await runNode('scripts/backup.js', { DATA_DIR: tmp });
  const backupLine = backup.split(/\r?\n/).find(line => line.startsWith('Backup written to '));
  const backupPath = backupLine?.replace('Backup written to ', '').trim();
  assert.ok(backupPath, backup);
  assert.ok(fs.existsSync(path.join(backupPath, 'manifest.json')));

  await runNode('scripts/restore.js', { DATA_DIR: restore, BACKUP_PATH: backupPath });
  assert.equal(fs.readFileSync(path.join(restore, 'uploads', 'scan.txt'), 'utf8'), 'scan');
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

function runNode(file, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `exit ${code}`)));
  });
}
