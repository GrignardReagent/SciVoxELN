import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('entry draft check flags missing notebook details and passes complete drafts locally', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-entry-draft-check-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-entry-draft-check',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;

  const { app } = await import(`../src/index.js?entry-draft-check=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'draft-check@biotech.test',
      name: 'Draft Check Scientist',
      password: 'draft-check-pass-123'
    });
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Draft check run',
      objective: 'Catch underspecified notes before save.'
    });

    const sparse = await scientist.req(base, 'POST', '/api/ai/check-entry-draft', {
      experimentId: exp.id,
      text: 'Looks cloudy after incubation.'
    });

    assert.equal(sparse.model, 'local-rules');
    assert.equal(sparse.offline, true);
    assert.equal(sparse.status, 'needs_details');
    assert.ok(sparse.score < 70);
    assert.equal(sparse.findings.find(f => f.key === 'sample_id')?.status, 'missing');
    assert.equal(sparse.findings.find(f => f.key === 'measurement')?.status, 'missing');
    assert.ok(sparse.suggestions.some(s => /sample|well|tube|lot/i.test(s)));
    assert.ok(sparse.suggestions.some(s => /measurement|value|result/i.test(s)));

    const complete = await scientist.req(base, 'POST', '/api/ai/check-entry-draft', {
      experimentId: exp.id,
      text: 'Sample A1 was incubated for 15 minutes at 37 C with 20 ul enzyme mix. Fluorescence increased to 0.82 RFU. No tube leak observed. Next repeat sample B2 with a fresh blank.'
    });

    assert.equal(complete.status, 'ready');
    assert.ok(complete.score >= 80);
    assert.equal(complete.findings.find(f => f.key === 'sample_id')?.status, 'present');
    assert.equal(complete.findings.find(f => f.key === 'conditions')?.status, 'present');
    assert.equal(complete.findings.find(f => f.key === 'measurement')?.status, 'present');
    assert.ok(complete.suggestions.length <= sparse.suggestions.length);

    const audit = await scientist.req(base, 'GET', '/api/audit');
    assert.ok(audit.some(row => row.action === 'LOCAL_CHECK_ENTRY_DRAFT'));
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
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
      if (!res.ok) throw new Error(`${res.status} ${data?.error || text}`);
      return data;
    }
  };
}

function snapshotEnv() {
  return {
    DATA_DIR: process.env.DATA_DIR,
    SEED: process.env.SEED,
    SESSION_SECRET: process.env.SESSION_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    SCIVOX_NO_LISTEN: process.env.SCIVOX_NO_LISTEN,
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL
  };
}

function restoreEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
