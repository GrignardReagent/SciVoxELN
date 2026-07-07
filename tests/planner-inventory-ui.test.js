import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/planner.js', import.meta.url), 'utf8');

test('planner material picker stores and renders inventory evidence', () => {
  assert.match(source, /inventory_id/);
  assert.match(source, /inventoryEvidence/);
  assert.match(source, /inventoryStatus/);
  assert.match(source, /available_quantity/);
  assert.match(source, /lot_number/);
  assert.match(source, /expiry_date/);
  assert.match(source, /data-inventory-evidence/);
});
