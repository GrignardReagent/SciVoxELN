import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('experiment export provides a ZIP evidence bundle with manifest and attachment bytes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-zip-export-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-zip-export',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?zip-export=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'zip.scientist@biotech.test',
      name: 'ZIP Scientist',
      password: 'zip-pass-123'
    });

    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Signed bundle assay',
      objective: 'Package export evidence as a transferable archive.',
      protocol: 'Run assay and attach instrument output.',
      tags: 'FAIR, archive'
    });
    const entry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Recorded endpoint readout and attached instrument CSV.'
    });
    const ref = await scientist.req(base, 'POST', '/api/references', {
      experimentId: exp.id,
      title: 'Archive reference',
      authors: 'Curie M',
      year: '2026',
      doi: '10.5555/archive'
    });
    const attachmentBytes = Buffer.from('well,signal\nA1,42\nB1,57\n');
    const attachment = await scientist.uploadAttachment(
      base,
      attachmentBytes,
      'plate reader output.csv',
      'text/csv',
      exp.id,
      'Instrument CSV from endpoint readout.'
    );

    const raw = await scientist.raw(base, 'GET', `/api/experiments/${exp.id}/export?format=zip`);
    assert.equal(raw.status, 200);
    assert.match(raw.headers['content-type'], /application\/zip/);
    assert.match(raw.headers['content-disposition'], /signed-bundle-assay-evidence-bundle\.zip/);
    assert.equal(raw.body.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');

    const entries = parseStoredZip(raw.body);
    const names = [...entries.keys()].sort();
    assert.deepEqual(names, [
      'attachments/plate-reader-output.csv',
      'audit.json',
      'experiment-export.html',
      'experiment-export.json',
      'manifest.json',
      'ro-crate-metadata.json'
    ]);

    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    assert.equal(manifest.bundle_version, 1);
    assert.equal(manifest.experiment_id, exp.id);
    assert.equal(manifest.eln_id, exp.eln_id);
    assert.match(manifest.export_sha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.files.every(file => file.path && file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.ok(manifest.files.some(file => file.path === 'attachments/plate-reader-output.csv' && file.source_id === attachment.id));

    const exported = JSON.parse(entries.get('experiment-export.json').toString('utf8'));
    assert.equal(exported.experiment.id, exp.id);
    assert.equal(exported.experiment.entries[0].id, entry.id);
    assert.equal(exported.references[0].id, ref.id);
    assert.equal(exported.attachments[0].hash, attachment.hash);

    const crate = JSON.parse(entries.get('ro-crate-metadata.json').toString('utf8'));
    assert.equal(crate['@context'], 'https://w3id.org/ro/crate/1.1/context');
    assert.ok(crate['@graph'].some(node => node['@id'] === `attachments/${attachment.id}`));

    const audit = JSON.parse(entries.get('audit.json').toString('utf8'));
    assert.ok(audit.some(row => row.action === 'ADD_EXPERIMENT_ATTACHMENT'));
    assert.ok(entries.get('experiment-export.html').includes(Buffer.from('Signed bundle assay')));
    assert.deepEqual(entries.get('attachments/plate-reader-output.csv'), attachmentBytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

function parseStoredZip(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    assert.equal(flags & 0x0008, 0, 'ZIP data descriptors are not supported by this parser');
    assert.equal(method, 0, 'test parser expects stored ZIP entries');
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
    entries.set(name, buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  assert.ok(entries.size, 'expected ZIP entries');
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'expected central directory after local entries');
  return entries;
}

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
    },
    async uploadAttachment(base, bytes, filename, mimeType, experimentId, note = '') {
      const fd = new FormData();
      fd.append('note', note);
      fd.append('file', new Blob([bytes], { type: mimeType }), filename);
      const res = await fetch(base + `/api/experiments/${experimentId}/attachments`, {
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
