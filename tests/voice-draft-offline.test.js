import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('voice lab-report drafting works offline without an OpenAI key', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-voice-offline-'));
  const previousEnv = {
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
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-voice-offline',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;

  const { app } = await import(`../src/index.js?voice-offline=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'voice-offline@biotech.test',
      name: 'Offline Scientist',
      password: 'voice-pass-123'
    });
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Offline voice report',
      objective: 'Draft a lab report when the network AI is not configured.'
    });

    const draft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Aliquoted sample D4 and added 20 ul enzyme mix. Incubated for 30 minutes at 37 C. Absorbance increased to 0.82 but replicate two was uncertain.',
      rawNotes: 'D4 endpoint report; preserve replicate uncertainty',
      template: 'lab_report'
    });

    assert.equal(draft.template, 'lab_report');
    assert.equal(draft.style, 'lab_report');
    assert.equal(draft.model, 'local-template');
    assert.equal(draft.offline, true);
    assert.match(draft.output, /^Objective\n/);
    assert.match(draft.output, /Method\n- Aliquoted sample D4 and added 20 ul enzyme mix\./);
    assert.match(draft.output, /Method[\s\S]*- Incubated for 30 minutes at 37 C\./);
    assert.match(draft.output, /Results \/ Observations\n- Absorbance increased to 0\.82 but replicate two was uncertain\./);
    assert.match(draft.output, /Deviations \/ Uncertainty\n- Absorbance increased to 0\.82 but replicate two was uncertain\./);

    const clean = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'added 5 ml buffer to sample a1 incubated 10 minutes sample cloudy no contamination observed stored tube b2 on ice',
      rawNotes: '',
      template: 'clean_voice_note'
    });

    assert.equal(clean.template, 'clean_voice_note');
    assert.equal(clean.style, 'clean_voice_note');
    assert.equal(clean.model, 'local-template');
    assert.equal(clean.offline, true);
    assert.match(clean.output, /^Added 5 ml buffer to sample A1\./);
    assert.match(clean.output, /Incubated 10 minutes\./);
    assert.match(clean.output, /Sample cloudy\./);
    assert.match(clean.output, /No contamination observed\./);
    assert.match(clean.output, /Stored tube B2 on ice\./);
    assert.match(clean.output, /\n\n/);
    assert.doesNotMatch(clean.output, /^added\b/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEnv(previousEnv);
  }
});

test('voice lab-report drafting falls back locally when configured AI fails', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-voice-ai-fallback-'));
  const previousEnv = {
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
  const mock = await failingOpenAiServer();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-voice-ai-fallback',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`,
    OPENAI_MODEL: 'mock-model'
  });

  const { app } = await import(`../src/index.js?voice-ai-fallback=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'voice-fallback@biotech.test',
      name: 'Fallback Scientist',
      password: 'voice-pass-123'
    });
    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      title: 'Voice fallback report',
      objective: 'Draft a lab report even when the remote AI draft call fails.'
    });

    const draft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Added buffer to sample B2. Incubated for 20 minutes at 30 C. Tube B2 remained clear.',
      rawNotes: '',
      template: 'lab_report'
    });

    assert.equal(draft.template, 'lab_report');
    assert.equal(draft.model, 'local-template');
    assert.equal(draft.offline, true);
    assert.equal(draft.fallback, true);
    assert.match(draft.output, /^Objective\n/);
    assert.match(draft.output, /Method\n- Added buffer to sample B2\./);
    assert.match(draft.output, /Results \/ Observations\n- Tube B2 remained clear\./);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => mock.close(resolve));
    restoreEnv(previousEnv);
  }
});

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function failingOpenAiServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock draft failure' } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function jar() {
  let cookie = '';
  return {
    async req(base, method, path, body) {
      const res = await fetch(base + path, {
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

function restoreEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
