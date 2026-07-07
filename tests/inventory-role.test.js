import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('inventory is read-only for viewer accounts and writable for scientist roles', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-inventory-role-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-inventory-role',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?inventoryRole=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();
    const viewer = jar();

    const adminUser = await admin.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-admin@scivox.test',
      name: 'Inventory Admin',
      password: 'inventory-admin-pass'
    });
    assert.equal(adminUser.role, 'admin');

    const scientistUser = await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-scientist@scivox.test',
      name: 'Inventory Scientist',
      password: 'inventory-scientist-pass'
    });
    assert.equal(scientistUser.role, 'user');

    const viewerUser = await viewer.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-viewer@scivox.test',
      name: 'Inventory Viewer',
      password: 'inventory-viewer-pass'
    });
    await admin.req(base, 'PATCH', `/api/users/${viewerUser.id}/role`, { role: 'viewer' });

    const tris = await admin.req(base, 'POST', '/api/inventory', {
      name: 'Tris buffer',
      category: 'Buffer',
      quantity: 50,
      unit: 'mL',
      reorder_level: 10,
      lot_number: 'TRIS-001'
    });

    const visible = await viewer.req(base, 'GET', '/api/inventory');
    assert.ok(visible.some(item => item.id === tris.id && item.name === 'Tris buffer'));

    await assert.rejects(
      () => viewer.req(base, 'POST', '/api/inventory', { name: 'Viewer-created reagent' }),
      /403/
    );
    await assert.rejects(
      () => viewer.req(base, 'PATCH', `/api/inventory/${tris.id}`, { quantity: 999 }),
      /403/
    );
    await assert.rejects(
      () => viewer.req(base, 'POST', `/api/inventory/${tris.id}/adjust`, { delta: -1, reason: 'viewer attempt' }),
      /403/
    );
    await assert.rejects(
      () => viewer.req(base, 'DELETE', `/api/inventory/${tris.id}`),
      /403/
    );

    const pbs = await scientist.req(base, 'POST', '/api/inventory', {
      name: 'PBS pH 7.4',
      category: 'Buffer',
      quantity: 12,
      unit: 'bottle',
      reorder_level: 2,
      lot_number: 'PBS-074'
    });
    assert.equal(pbs.name, 'PBS pH 7.4');

    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/inventory', {
        name: 'Negative stock reagent',
        quantity: -1,
        unit: 'mL',
        reorder_level: 0
      }),
      /400 Quantity cannot be negative/
    );
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/inventory/${pbs.id}`, { quantity: -5 }),
      /400 Quantity cannot be negative/
    );
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/inventory/${pbs.id}`, { reorder_level: -1 }),
      /400 Reorder level cannot be negative/
    );
    const afterNegativeEdits = await scientist.req(base, 'GET', `/api/inventory/${pbs.id}`);
    assert.equal(afterNegativeEdits.quantity, 12);
    assert.equal(afterNegativeEdits.reorder_level, 2);

    const adjusted = await scientist.req(base, 'POST', `/api/inventory/${pbs.id}/adjust`, {
      delta: -2,
      reason: 'used for formulation prep'
    });
    assert.equal(adjusted.quantity, 10);

    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/inventory/${pbs.id}/adjust`, {
        delta: -20,
        reason: 'impossible over-consumption'
      }),
      /409 Insufficient stock: 10 bottle available/
    );
    const afterImpossibleConsume = await scientist.req(base, 'GET', `/api/inventory/${pbs.id}`);
    assert.equal(afterImpossibleConsume.quantity, 10);

    const afterViewerAttempts = await admin.req(base, 'GET', `/api/inventory/${tris.id}`);
    assert.equal(afterViewerAttempts.quantity, 50);

    const audit = await admin.req(base, 'GET', '/api/audit?action=CONSUME_INVENTORY');
    assert.ok(audit.some(row => row.detail.includes('PBS pH 7.4') && row.detail.includes('used for formulation prep')));
    assert.equal(audit.some(row => row.detail.includes('impossible over-consumption')), false);
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
