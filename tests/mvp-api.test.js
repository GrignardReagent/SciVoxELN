import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('MVP pilot workflow: projects, access, signatures, exports, audit and session revocation', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-mvp-'));
  const ai = await mockOpenAI();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-mvp-api',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: ai.baseUrl,
    OPENAI_MODEL: 'mock-gpt'
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
    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
        experimentId: exp.id,
        transcript: 'Viewer should not polish voice drafts.',
        manualNotes: '',
        style: 'numbered_bullets'
      }),
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

    const edited = await scientist.req(base, 'PATCH', `/api/entries/${entry.id}`, {
      text: 'Prepared formulation A and recorded visual clarity after thaw.'
    });
    assert.equal(edited.text, 'Prepared formulation A and recorded visual clarity after thaw.');
    assert.notEqual(edited.hash, entry.hash);

    const generated = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'AI-generated summary from one selected entry.',
      sourceEntryIds: [entry.id]
    });
    assert.deepEqual(JSON.parse(generated.source_entry_ids), [entry.id]);

    await assert.rejects(
      () => scientist.req(base, 'DELETE', '/api/entries/batch', { entryIds: [generated.id] }),
      /403/
    );
    const batchDeleted = await admin.req(base, 'DELETE', '/api/entries/batch', { entryIds: [generated.id] });
    assert.equal(batchDeleted.deleted, 1);

    const entries = await scientist.req(base, 'GET', '/api/entries');
    const libraryEntry = entries.find(e => e.id === entry.id);
    assert.equal(libraryEntry.experiment_title, exp.title);
    assert.equal(libraryEntry.project_id, project.id);
    assert.equal(entries.some(e => e.id === generated.id), false);

    const bulletDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Added 5 mL buffer to sample A1 and incubated at 37 C for 15 minutes.',
      manualNotes: 'Important: A1 looked cloudy after incubation.',
      style: 'numbered_bullets'
    });
    assert.equal(bulletDraft.style, 'numbered_bullets');
    assert.equal(bulletDraft.model, 'mock-gpt');
    assert.match(bulletDraft.output, /^1\. Added 5 mL buffer to sample A1\./);
    assert.match(bulletDraft.output, /\n2\. Incubated at 37 C for 15 minutes\./);
    assert.doesNotMatch(bulletDraft.output, /^-/m);

    const paragraphDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Measured pH 7.4 and stored tube B2 on ice.',
      manualNotes: '',
      style: 'concise_paragraph'
    });
    assert.equal(paragraphDraft.style, 'concise_paragraph');
    assert.match(paragraphDraft.output, /^Measured pH 7\.4 and stored tube B2 on ice\./);
    assert.doesNotMatch(paragraphDraft.output, /^\d+\./m);

    const rawVoice = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'voice_transcript',
      text: 'Manual notes:\nA1 looked cloudy.\n\nSource transcript:\nAdded confidential phrase XYZ-123 and incubated sample A1.'
    });
    assert.equal(rawVoice.type, 'voice_transcript');
    const polishedVoice = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'voice',
      text: bulletDraft.output,
      sourceEntryIds: [rawVoice.id]
    });
    assert.deepEqual(JSON.parse(polishedVoice.source_entry_ids), [rawVoice.id]);
    const expWithVoice = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(expWithVoice.entries.some(en => en.id === rawVoice.id), false);
    assert.equal(expWithVoice.entries.some(en => en.id === polishedVoice.id), true);
    const libraryAfterVoice = await scientist.req(base, 'GET', '/api/entries');
    assert.equal(libraryAfterVoice.some(en => en.id === rawVoice.id), false);
    const sourceTranscript = await scientist.req(base, 'GET', `/api/entries/${rawVoice.id}`);
    assert.equal(sourceTranscript.text, rawVoice.text);
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/entries/${rawVoice.id}`, { text: 'tampered source transcript' }),
      /409/
    );

    const rawUpload = await scientist.uploadImage(base, tinyPng(), 'raw-slide-sketch.png', 'figure-raw', exp.id);
    const cleanUpload = await scientist.uploadImage(base, tinyPng(), 'clean-slide-diagram.png', 'figure-clean', exp.id);
    assert.match(rawUpload.url, new RegExp(`^/uploads/figures/${exp.id}/raw/`));
    assert.match(cleanUpload.url, new RegExp(`^/uploads/figures/${exp.id}/clean/`));

    const figure = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'figure',
      text: 'Microscope slide layout with sample regions A-D.',
      imageUrl: cleanUpload.url,
      rawImageUrl: rawUpload.url,
      cleanImageUrl: cleanUpload.url
    });
    assert.equal(figure.type, 'figure');
    assert.equal(figure.raw_image_url, rawUpload.url);
    assert.equal(figure.clean_image_url, cleanUpload.url);

    const singleDeleteEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Duplicate note to delete from the experiment page.'
    });
    await assert.rejects(
      () => scientist.req(base, 'DELETE', `/api/entries/${singleDeleteEntry.id}`, { reason: 'scientist should not delete entries' }),
      /403/
    );
    await admin.req(base, 'DELETE', `/api/entries/${singleDeleteEntry.id}`, { reason: 'duplicate note from experiment page' });
    const expAfterEntryDelete = await admin.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(expAfterEntryDelete.entries.some(en => en.id === singleDeleteEntry.id), false);

    const deletableExp = await admin.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'Temporary calibration run',
      objective: 'Exercise deletion audit context.'
    });
    const deletableEntry = await scientist.req(base, 'POST', `/api/experiments/${deletableExp.id}/entries`, {
      type: 'note',
      text: 'Temporary observation for deletion.'
    });
    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'owner'
    });
    await assert.rejects(
      () => scientist.req(base, 'DELETE', `/api/experiments/${deletableExp.id}`, { reason: 'owner should not delete experiments' }),
      /403/
    );
    await admin.req(base, 'DELETE', `/api/experiments/${deletableExp.id}`, { reason: 'duplicate calibration run' });
    await assert.rejects(
      () => admin.req(base, 'GET', `/api/experiments/${deletableExp.id}`),
      /404/
    );

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

    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/entries/${entry.id}`, { text: 'cannot edit signed entry' }),
      /409/
    );

    await admin.req(base, 'POST', `/api/experiments/${exp.id}/lock`);
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'after lock' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'voice_transcript', text: 'after lock transcript' }),
      /409/
    );

    const exported = await admin.req(base, 'GET', `/api/experiments/${exp.id}/export`);
    assert.equal(exported.experiment.id, exp.id);
    assert.match(exported.integrity.sha256, /^[a-f0-9]{64}$/);
    assert.ok(exported.experiment.entries.some(en => en.id === rawVoice.id));
    const exportedPdf = await admin.raw(base, 'GET', `/api/experiments/${exp.id}/export?format=pdf`);
    assert.equal(exportedPdf.status, 200);
    assert.match(exportedPdf.headers['content-type'], /application\/pdf/);
    assert.match(exportedPdf.headers['content-disposition'], /mrna-stability-screen-export\.pdf/);
    assert.equal(exportedPdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(exportedPdf.body.includes(Buffer.from('mRNA stability screen')));

    const audit = await admin.req(base, 'GET', `/api/audit?project=${project.id}`);
    assert.ok(audit.some(a => a.action === 'SIGN_ENTRY'));
    assert.ok(audit.some(a => a.action === 'ADD_FIGURE_ENTRY'));
    assert.ok(audit.some(a => a.action === 'AI_POLISH_VOICE_DRAFT' && a.detail.includes('numbered_bullets')));
    assert.ok(audit.some(a => a.action === 'AI_POLISH_VOICE_DRAFT' && a.detail.includes('concise_paragraph')));
    assert.ok(audit.some(a => a.action === 'ADD_VOICE_TRANSCRIPT_SOURCE' && a.detail.includes(rawVoice.id)));
    assert.equal(audit.some(a => a.detail.includes('confidential phrase XYZ-123')), false);
    assert.ok(audit.some(a =>
      a.action === 'DELETE_ENTRY' &&
      a.detail.includes(singleDeleteEntry.id) &&
      a.detail.includes('reason: duplicate note from experiment page') &&
      a.detail.includes(`hash ${singleDeleteEntry.hash}`)
    ));
    assert.ok(audit.some(a =>
      a.action === 'DELETE_EXPERIMENT' &&
      a.detail.includes(deletableExp.id) &&
      a.detail.includes('reason: duplicate calibration run') &&
      a.detail.includes('entries deleted: 1') &&
      a.detail.includes(`entry hashes: ${deletableEntry.hash}`)
    ));
    assert.ok(audit.every(a => a.hash && a.previous_hash != null));

    const search = await scientist.req(base, 'GET', '/api/search?q=formulation clarity');
    assert.ok(search.entries.some(e => e.id === entry.id));

    await scientist.req(base, 'POST', '/api/auth/sessions/revoke', {});
    await assert.rejects(() => scientist.req(base, 'GET', '/api/experiments'), /401/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => ai.server.close(resolve));
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

test('migration upgrades a pre-project database without crashing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-legacy-db-'));
  const dbPath = path.join(tmp, 'scivox.db');
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
      image_url TEXT, hash TEXT NOT NULL, signed_by TEXT, signed_role TEXT,
      signed_at TEXT, sig TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, experiment_id TEXT, title TEXT NOT NULL,
      hypothesis TEXT DEFAULT '', variables TEXT DEFAULT '[]', steps TEXT DEFAULT '[]',
      materials TEXT DEFAULT '[]', expected_outcome TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE inventory (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '',
      catalog_number TEXT DEFAULT '', lot_number TEXT DEFAULT '', location TEXT DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT '', reorder_level REAL NOT NULL DEFAULT 0,
      expiry_date TEXT, notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE audit (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, user TEXT DEFAULT 'Unknown',
      role TEXT DEFAULT '', action TEXT NOT NULL, detail TEXT DEFAULT ''
    );
  `);
  legacy.close();

  await runNodeEval("import('./src/db.js').then(m => m.migrate())", { DATA_DIR: tmp, DB_PATH: dbPath, NODE_NO_WARNINGS: '1' });

  const upgraded = new DatabaseSync(dbPath);
  const auditCols = upgraded.prepare('PRAGMA table_info(audit)').all().map(c => c.name);
  const expCols = upgraded.prepare('PRAGMA table_info(experiments)').all().map(c => c.name);
  assert.ok(auditCols.includes('project_id'));
  assert.ok(auditCols.includes('hash'));
  assert.ok(expCols.includes('project_id'));
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_project'").get());
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
    },
    async raw(base, method, url, body) {
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
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`${res.status} ${buffer.toString('utf8') || res.statusText}`);
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: buffer
      };
    },
    async uploadImage(base, bytes, filename, kind, experimentId = '') {
      const fd = new FormData();
      fd.append('kind', kind);
      if (experimentId) fd.append('experimentId', experimentId);
      fd.append('image', new Blob([bytes], { type: 'image/png' }), filename);
      const res = await fetch(base + '/api/uploads', {
        method: 'POST',
        headers: cookie ? { cookie } : {},
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${data.error || res.statusText}`);
      return data;
    }
  };
}

function tinyPng() {
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  ));
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function mockOpenAI() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    const userText = payload.messages?.map(m => m.content).join('\n') || '';
    const content = userText.includes('concise_paragraph')
      ? 'Measured pH 7.4 and stored tube B2 on ice. No additional result was stated.'
      : ['Added 5 mL buffer to sample A1.', 'Incubated at 37 C for 15 minutes.', 'A1 looked cloudy after incubation.'].map((line, i) => `${i + 1}. ${line}`).join('\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
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

function runNodeEval(code, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
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
