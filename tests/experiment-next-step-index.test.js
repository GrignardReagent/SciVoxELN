import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('experiment list returns next open procedure step and step progress', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-next-step-index-'));
  const previousEnv = snapshotEnv();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-next-step-index',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });

  const { app } = await import(`../src/index.js?next-step-index=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'next-step@biotech.test',
      name: 'Next Step Scientist',
      password: 'next-step-pass-123'
    });
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Next step index run',
      objective: 'Surface the next actionable checklist item.'
    });
    const stepOne = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, {
      text: 'Equilibrate plate reader to 37 C.'
    });
    await scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, {
      text: 'Load samples A1 through A8.'
    });

    let listed = await scientist.req(base, 'GET', '/api/experiments');
    let row = listed.find(item => item.id === exp.id);
    assert.equal(row.next_step, 'Equilibrate plate reader to 37 C.');
    assert.equal(row.next_step_id, stepOne.id);
    assert.equal(row.stepCount, 2);
    assert.equal(row.openStepCount, 2);
    assert.equal(row.completedStepCount, 0);

    await scientist.req(base, 'PATCH', `/api/experiments/${exp.id}/steps/${stepOne.id}`, { done: true });
    listed = await scientist.req(base, 'GET', '/api/experiments');
    row = listed.find(item => item.id === exp.id);
    assert.equal(row.next_step, 'Load samples A1 through A8.');
    assert.equal(row.stepCount, 2);
    assert.equal(row.openStepCount, 1);
    assert.equal(row.completedStepCount, 1);
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
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS
  };
}

function restoreEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
