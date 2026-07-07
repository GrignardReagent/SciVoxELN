import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('starting a plan preserves protocol setup and seeds a plan snapshot entry', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-planner-start-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-planner-start',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?plannerStart=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'planner-scientist@scivox.test',
      name: 'Planner Scientist',
      password: 'planner-scientist-pass'
    });

    const plan = await scientist.req(base, 'POST', '/api/plans', {
      title: 'Cytokine dose response',
      hypothesis: 'IL-2 increases STAT5 phosphorylation in a dose-dependent manner.',
      variables: [
        { name: 'IL-2 concentration', type: 'independent', values: '0, 1, 10, 100 ng/mL' },
        { name: 'pSTAT5 MFI', type: 'dependent', values: 'flow cytometry' }
      ],
      steps: [
        { text: 'Seed 200,000 cells per well.', done: false },
        { text: 'Stimulate with IL-2 for 20 minutes at 37 C.', done: false },
        { text: 'Fix, permeabilize, stain pSTAT5 and acquire by flow.', done: false }
      ],
      materials: [
        { name: 'Human PBMC', amount: '2', unit: 'million cells' },
        { name: 'Recombinant IL-2', amount: '10', unit: 'ug' }
      ],
      expected_outcome: 'Accept if pSTAT5 MFI increases monotonically with IL-2 dose.',
      status: 'ready'
    });

    const started = await scientist.req(base, 'POST', `/api/plans/${plan.id}/start`);
    const exp = started.experiment;
    assert.equal(exp.title, 'Cytokine dose response');
    assert.equal(exp.hypothesis, 'IL-2 increases STAT5 phosphorylation in a dose-dependent manner.');
    assert.match(exp.objective, /Accept if pSTAT5 MFI increases monotonically/);
    assert.match(exp.protocol, /1\. Seed 200,000 cells per well\./);
    assert.match(exp.protocol, /3\. Fix, permeabilize, stain pSTAT5 and acquire by flow\./);
    assert.match(exp.materials, /Human PBMC — 2 million cells/);
    assert.match(exp.materials, /Recombinant IL-2 — 10 ug/);
    assert.equal(exp.success_criteria, 'Accept if pSTAT5 MFI increases monotonically with IL-2 dose.');

    const fetched = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    const snapshot = fetched.entries.find(en => en.type === 'plan');
    assert.ok(snapshot);
    assert.match(snapshot.text, /Plan: Cytokine dose response/);
    assert.match(snapshot.text, /Variables/);
    assert.match(snapshot.text, /IL-2 concentration \(independent\): 0, 1, 10, 100 ng\/mL/);
    assert.match(snapshot.text, /Protocol steps/);
    assert.match(snapshot.text, /Materials/);
    assert.match(snapshot.hash, /^[a-f0-9]{64}$/);

    const audit = await scientist.req(base, 'GET', '/api/audit?action=START_PLAN');
    assert.ok(audit.some(row => row.detail.includes(plan.title) && row.detail.includes(exp.id)));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('starting a plan preserves inventory evidence for picked materials', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-planner-inventory-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-planner-inventory',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?plannerInventory=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const scientist = jar();
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'planner-inventory-scientist@scivox.test',
      name: 'Planner Inventory Scientist',
      password: 'planner-inventory-pass'
    });

    const reagent = await scientist.req(base, 'POST', '/api/inventory', {
      name: 'Anti-pSTAT5 antibody',
      category: 'Antibody',
      catalog_number: '560311',
      lot_number: 'AB-0426',
      location: 'Fridge 4C / Box 7',
      quantity: 4,
      unit: 'uL',
      reorder_level: 10,
      expiry_date: '2026-07-20',
      notes: 'Protect from light'
    });

    const plan = await scientist.req(base, 'POST', '/api/plans', {
      title: 'Inventory-linked phospho-flow',
      hypothesis: 'The selected antibody lot is suitable for the run.',
      steps: [{ text: 'Stain fixed cells with anti-pSTAT5 antibody.', done: false }],
      materials: [{
        inventory_id: reagent.id,
        name: reagent.name,
        amount: '5',
        unit: 'uL',
        lot_number: reagent.lot_number,
        catalog_number: reagent.catalog_number,
        location: reagent.location,
        available_quantity: reagent.quantity,
        available_unit: reagent.unit,
        reorder_level: reagent.reorder_level,
        expiry_date: reagent.expiry_date,
        inventory_status: 'low'
      }],
      expected_outcome: 'Record the exact lot and stock warning before the run.',
      status: 'ready'
    });

    const started = await scientist.req(base, 'POST', `/api/plans/${plan.id}/start`);
    assert.match(started.experiment.materials, /Anti-pSTAT5 antibody — 5 uL/);
    assert.match(started.experiment.materials, /lot AB-0426/);
    assert.match(started.experiment.materials, /cat 560311/);
    assert.match(started.experiment.materials, /Fridge 4C \/ Box 7/);
    assert.match(started.experiment.materials, /available 4 uL/);
    assert.match(started.experiment.materials, /expires 2026-07-20/);
    assert.match(started.experiment.materials, /status low/);

    const fetched = await scientist.req(base, 'GET', `/api/experiments/${started.experiment.id}`);
    const snapshot = fetched.entries.find(en => en.type === 'plan');
    assert.ok(snapshot);
    assert.match(snapshot.text, /Anti-pSTAT5 antibody — 5 uL/);
    assert.match(snapshot.text, /lot AB-0426/);
    assert.match(snapshot.text, /available 4 uL/);
    assert.match(snapshot.text, /status low/);
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
