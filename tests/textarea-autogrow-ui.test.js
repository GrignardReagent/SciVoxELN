import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../public/js/ui.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('shared UI installs auto-growing textareas for views and modals', () => {
  assert.match(ui, /export function autoGrowTextareas/);
  assert.match(ui, /export function installTextareaAutoGrow/);
  assert.match(ui, /textarea/);
  assert.match(ui, /scrollHeight/);
  assert.match(ui, /style\.height = 'auto'/);
  assert.match(ui, /addEventListener\('input'/);
  assert.match(ui, /addEventListener\('resize'/);
  assert.match(ui, /MutationObserver/);
  assert.match(ui, /modal[\s\S]*autoGrowTextareas/);
  assert.match(app, /installTextareaAutoGrow/);
  assert.match(styles, /textarea\.txt\{[^}]*overflow-y:hidden/);
});
