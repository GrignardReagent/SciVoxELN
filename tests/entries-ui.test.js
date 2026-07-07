import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/entries.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('entries library source chips open traceable source records', () => {
  assert.match(source, /wireSourceLinks/);
  assert.match(source, /data-source-entry/);
  assert.match(source, /openSourceEntryModal/);
  assert.match(source, /api\.entry\(btn\.dataset\.sourceEntry\)/);
  assert.match(source, /Source transcript/);
  assert.match(source, /Source entry/);
  assert.match(source, /entry-focus/);
});

test('entries library rows expose labelled metadata for scanning', () => {
  assert.match(source, /entryMetaHTML/);
  assert.match(source, /data-entry-meta/);
  assert.match(source, /entry-lib-meta-grid/);
  assert.match(source, /entry-lib-meta-item/);
  assert.match(source, /Experiment/);
  assert.match(source, /Project/);
  assert.match(source, /Created/);
  assert.match(source, /Author/);
  assert.match(source, /Fingerprint/);
  assert.match(styles, /\.entry-lib-meta-grid/);
  assert.match(styles, /\.entry-lib-meta-item/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.entry-lib-meta-grid\{grid-template-columns:1fr\}/);
});
