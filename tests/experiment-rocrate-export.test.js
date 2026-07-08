import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('experiment export provides RO-Crate JSON-LD metadata for FAIR reuse', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-rocrate-export-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-rocrate-export',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?rocrate-export=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'rocrate.scientist@biotech.test',
      name: 'RO-Crate Scientist',
      password: 'rocrate-pass-123'
    });

    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Interoperable assay record',
      objective: 'Export assay context as linked metadata.',
      hypothesis: 'A JSON-LD crate improves reuse.',
      protocol: 'Seed cells, dose compound, read luminescence.',
      materials: 'HEK293 cells; compound plate CP-42.',
      success_criteria: 'Signal-to-background above 10.',
      safety_notes: 'Handle DMSO stocks in a hood.',
      tags: 'FAIR, assay',
      metadata: {
        extra_fields: {
          'Cell line': { value: 'HEK293', position: 1 },
          'Readout': { value: 'luminescence', unit: 'RLU', position: 2 }
        }
      }
    });
    const entry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Day 1: seeded 12,000 cells per well and recorded plate map.'
    });
    const ref = await scientist.req(base, 'POST', '/api/references', {
      experimentId: exp.id,
      title: 'Assay reference',
      authors: 'Doe J',
      year: '2026',
      doi: '10.1234/example'
    });

    const raw = await scientist.raw(base, 'GET', `/api/experiments/${exp.id}/export?format=rocrate`);
    assert.equal(raw.status, 200);
    assert.match(raw.headers['content-type'], /application\/ld\+json/);
    assert.match(raw.headers['content-disposition'], /interoperable-assay-record-ro-crate-metadata\.json/);

    const crate = JSON.parse(raw.body.toString('utf8'));
    assert.equal(crate['@context'], 'https://w3id.org/ro/crate/1.1/context');
    assert.equal(crate.export_version, 1);
    assert.match(crate.integrity.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(crate['@graph']));

    const metadata = crate['@graph'].find(node => node['@id'] === 'ro-crate-metadata.json');
    assert.equal(metadata['@type'], 'CreativeWork');
    assert.equal(metadata.conformsTo['@id'], 'https://w3id.org/ro/crate/1.1');

    const root = crate['@graph'].find(node => node['@id'] === './');
    assert.equal(root['@type'], 'Dataset');
    assert.equal(root.identifier, exp.eln_id);
    assert.deepEqual(root.hasPart.map(part => part['@id']).sort(), [
      `audit/${exp.id}`,
      `experiments/${exp.id}`,
      `references/${ref.id}`
    ].sort());

    const experiment = crate['@graph'].find(node => node['@id'] === `experiments/${exp.id}`);
    assert.equal(experiment['@type'], 'Dataset');
    assert.equal(experiment.name, exp.title);
    assert.equal(experiment.identifier, exp.eln_id);
    assert.ok(experiment.keywords.includes('FAIR'));
    assert.ok(experiment.hasPart.some(part => part['@id'] === `entries/${entry.id}`));
    assert.ok(experiment.variableMeasured.some(item => item.name === 'Readout' && item.value === 'luminescence RLU'));
    assert.ok(experiment.additionalProperty.some(item => item.name === 'Protocol / method' && item.value.includes('Seed cells')));

    const entryNode = crate['@graph'].find(node => node['@id'] === `entries/${entry.id}`);
    assert.equal(entryNode['@type'], 'CreativeWork');
    assert.equal(entryNode.text, entry.text);
    assert.equal(entryNode.sha256, entry.hash);

    const referenceNode = crate['@graph'].find(node => node['@id'] === `references/${ref.id}`);
    assert.equal(referenceNode['@type'], 'ScholarlyArticle');
    assert.equal(referenceNode.name, 'Assay reference');
    assert.equal(referenceNode.identifier, '10.1234/example');

    const auditNode = crate['@graph'].find(node => node['@id'] === `audit/${exp.id}`);
    assert.equal(auditNode['@type'], 'CreativeWork');
    assert.equal(auditNode.sha256, crate.integrity.sha256);
  } finally {
    await new Promise(resolve => server.close(resolve));
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
