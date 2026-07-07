import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('reviewer and approval signatures require project reviewer access', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-signature-role-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-signature-role',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?signatureRole=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();
    const reviewer = jar();

    await admin.req(base, 'POST', '/api/auth/register', {
      email: 'signature-admin@scivox.test',
      name: 'Signature Admin',
      password: 'signature-admin-pass'
    });
    const project = await admin.req(base, 'POST', '/api/projects', {
      name: 'Signature Review Project'
    });
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'signature-scientist@scivox.test',
      name: 'Signature Scientist',
      password: 'signature-scientist-pass'
    });
    await reviewer.req(base, 'POST', '/api/auth/register', {
      email: 'signature-reviewer@scivox.test',
      name: 'Signature Reviewer',
      password: 'signature-reviewer-pass'
    });
    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'signature-scientist@scivox.test',
      role: 'scientist'
    });
    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'signature-reviewer@scivox.test',
      role: 'reviewer'
    });

    const exp = await scientist.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'Signature role enforcement',
      objective: 'Verify only reviewers can apply review signatures.'
    });
    const authorEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Author note for regular signature.'
    });
    const reviewerEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Entry requiring reviewer signature.'
    });
    const approvalEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Entry requiring approval signature.'
    });

    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${reviewerEntry.id}/sign`, {
        meaning: 'reviewer',
        password: 'signature-scientist-pass'
      }),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${approvalEntry.id}/sign`, {
        meaning: 'approval',
        password: 'signature-scientist-pass'
      }),
      /403/
    );

    const authorSigned = await scientist.req(base, 'POST', `/api/entries/${authorEntry.id}/sign`, {
      meaning: 'author',
      password: 'signature-scientist-pass'
    });
    assert.equal(authorSigned.signature_meaning, 'author');

    const reviewerSigned = await reviewer.req(base, 'POST', `/api/entries/${reviewerEntry.id}/sign`, {
      meaning: 'reviewer',
      password: 'signature-reviewer-pass'
    });
    assert.equal(reviewerSigned.signature_meaning, 'reviewer');
    assert.equal(reviewerSigned.signed_by, 'Signature Reviewer');

    const audit = await admin.req(base, 'GET', `/api/audit?project=${project.id}&action=SIGN_ENTRY`);
    assert.ok(audit.some(row => row.detail.includes('author signature')));
    assert.ok(audit.some(row => row.detail.includes('reviewer signature')));
    assert.equal(audit.some(row => row.detail.includes('approval signature')), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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
