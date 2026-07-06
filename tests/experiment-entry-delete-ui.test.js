import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/experiments.js', import.meta.url), 'utf8');

test('experiment entries always render delete controls with admin-only disabled affordance', () => {
  assert.match(source, /data-delete-entry/);
  assert.match(source, /disabled[^`]*Admin only|Admin only[^`]*disabled/s);
  assert.doesNotMatch(source, /\$\{canDelete \? `<button class="btn danger sm" data-delete-entry/);
});

test('experiment detail renders an admin-gated delete button wired to a reasoned API call', () => {
  assert.match(source, /data-delete-experiment/);
  assert.match(source, /Locked experiments cannot be deleted/);
  assert.match(source, /Deletion reason required/);
  assert.match(source, /api\.deleteExperiment\(exp\.id,\s*\{\s*reason\s*\}\)/);
});
