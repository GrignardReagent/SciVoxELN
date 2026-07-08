import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('entry summarisation works locally without an OpenAI key', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-entry-summary-offline-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-entry-summary-offline',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;

  const { app } = await import(`../src/index.js?entry-summary-offline=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'summary-offline@biotech.test',
      name: 'Summary Scientist',
      password: 'summary-pass-123'
    });
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Offline summary run',
      objective: 'Condense notebook observations without a network AI dependency.'
    });
    const entryOne = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Prepared sample A1 with 10 microliters buffer and 2 microliters enzyme mix. Incubated at 37 C for 15 minutes. The solution stayed clear.'
    });
    const entryTwo = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Measured fluorescence at endpoint and recorded a moderate increase versus blank. Replicate B was excluded because the tube cap leaked.'
    });

    const summary = await scientist.req(base, 'POST', '/api/ai/process-entries', {
      entryIds: [entryOne.id, entryTwo.id],
      mode: 'summary'
    });

    assert.equal(summary.mode, 'summary');
    assert.equal(summary.model, 'local-template');
    assert.equal(summary.offline, true);
    assert.equal(summary.selectedCount, 2);
    assert.deepEqual(summary.experimentIds, [exp.id]);
    assert.match(summary.output, /Prepared sample A1/i);
    assert.match(summary.output, /fluorescence/i);
    assert.doesNotMatch(summary.output, /```|^#/m);
    assert.ok(summary.output.split(/\s+/).length < `${entryOne.text} ${entryTwo.text}`.split(/\s+/).length);

    const actionPlan = await scientist.req(base, 'POST', '/api/ai/process-entries', {
      entryIds: [entryOne.id, entryTwo.id],
      mode: 'action_plan'
    });

    assert.equal(actionPlan.mode, 'action_plan');
    assert.equal(actionPlan.model, 'local-template');
    assert.equal(actionPlan.offline, true);
    assert.equal(actionPlan.selectedCount, 2);
    assert.deepEqual(actionPlan.experimentIds, [exp.id]);
    const planLines = actionPlan.output.split(/\r?\n/).filter(Boolean);
    assert.equal(planLines.length, 4);
    assert.ok(planLines.every(line => /^- /.test(line)));
    assert.match(actionPlan.output, /Prepared sample A1|fluorescence|Replicate B/i);
    assert.doesNotMatch(actionPlan.output, /```|^#/m);
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
      const data = text ? JSON.parse(text) : null;
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
