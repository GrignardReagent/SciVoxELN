import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../public/js/ui.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const experiments = fs.readFileSync(new URL('../public/js/views/experiments.js', import.meta.url), 'utf8');
const observer = fs.readFileSync(new URL('../public/js/observer.js', import.meta.url), 'utf8');
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

test('programmatic textarea fills recalculate auto-grow height', () => {
  assert.match(experiments, /applyExperimentTemplate[\s\S]*autoGrowTextareas\(modalEl\)/);
  assert.match(experiments, /textEl\.value = prompt[\s\S]*autoGrowTextareas\(textEl\)/);
  assert.match(experiments, /polishedEl\.value = res\.output \|\| ''[\s\S]*autoGrowTextareas\(reviewWrap\)/);
  assert.match(experiments, /text\.value = ''[\s\S]*autoGrowTextareas\(mount\)/);
  assert.match(observer, /autoGrowTextareas/);
  assert.match(observer, /transcriptEl\.value = t[\s\S]*autoGrowTextareas\(transcriptEl\)/);
});

test('shared auto-grow handles revealed editors and direct value assignments', () => {
  assert.match(ui, /HTMLTextAreaElement\.prototype/);
  assert.match(ui, /Object\.getOwnPropertyDescriptor\(HTMLTextAreaElement\.prototype, 'value'\)/);
  assert.match(ui, /addEventListener\('focus'/);
  assert.match(ui, /ResizeObserver/);
  assert.match(ui, /clientWidth === 0 && el\.scrollHeight === 0/);
});

test('shared auto-grow recalculates when hidden textarea containers are revealed', () => {
  assert.match(ui, /record\.type === 'attributes'/);
  assert.match(ui, /attributeFilter:\s*\[\s*'hidden',\s*'class'\s*\]/);
  assert.match(ui, /autoGrowTextareas\(record\.target\)/);
});

test('auto-grow observer does not watch style (prevents infinite refit loop)', () => {
  // growTextarea() writes el.style.height on every fit. If the MutationObserver
  // also watched 'style', each write would re-trigger a refit that writes style
  // again — an infinite feedback loop that hard-freezes the tab. Reveal/resize
  // is covered by childList, the 'hidden'/'class' watches, and the ResizeObserver.
  const filterMatch = ui.match(/attributeFilter:\s*\[([^\]]*)\]/);
  assert.ok(filterMatch, 'expected an attributeFilter on the auto-grow observer');
  assert.ok(!/['"]style['"]/.test(filterMatch[1]),
    "auto-grow observer must not include 'style' in attributeFilter");
});
