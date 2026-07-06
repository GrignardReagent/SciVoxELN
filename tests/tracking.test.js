import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const trackingScript = path.join(repoRoot, 'scripts', 'tracking.js');

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function git(cwd, args) {
  return run('git', args, cwd);
}

function runTracking(cwd, args = ['check']) {
  return run(process.execPath, [trackingScript, ...args], cwd);
}

function runTrackingResult(cwd, args = ['check']) {
  try {
    return { ok: true, stdout: runTracking(cwd, args), stderr: '', status: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      status: error.status
    };
  }
}

function setupRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'scivox-tracking-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Tracking Test']);
  writeFileSync(path.join(dir, 'TRACKING.md'), [
    '# Tracking',
    '',
    '## Change Log',
    ''
  ].join('\n'));
  git(dir, ['add', 'TRACKING.md']);
  git(dir, ['commit', '-m', 'initial tracking']);
  return dir;
}

function writeFeature(repo, file = 'src/app.js') {
  const absolute = path.join(repo, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'export const ok = true;\n');
  git(repo, ['add', file]);
}

function appendTracking(repo, text) {
  const trackingPath = path.join(repo, 'TRACKING.md');
  const current = readFileSync(trackingPath, 'utf8');
  writeFileSync(trackingPath, `${current}\n${text}\n`);
  git(repo, ['add', 'TRACKING.md']);
}

test('staged code change without TRACKING appends draft and exits nonzero', () => {
  const repo = setupRepo();
  writeFeature(repo);

  const result = runTrackingResult(repo);
  assert.equal(result.ok, false);
  assert.equal(result.status, 1);

  const tracking = readFileSync(path.join(repo, 'TRACKING.md'), 'utf8');
  assert.match(tracking, /REPLACE: summarize change/);
  assert.match(tracking, /`src\/app\.js`/);
});

test('staged code plus valid staged TRACKING exits zero', () => {
  const repo = setupRepo();
  writeFeature(repo);
  appendTracking(repo, [
    '### 2026-07-06T00:00:00.000Z - Add tracked feature',
    '',
    '- Task: SVX-001',
    '- Branch: `svx-001-feature`',
    '- Summary: Adds a tracked feature.',
    '- Files:',
    '  - `src/app.js`'
  ].join('\n'));

  const result = runTrackingResult(repo);
  assert.equal(result.ok, true);
});

test('placeholder summary exits nonzero', () => {
  const repo = setupRepo();
  appendTracking(repo, [
    '### 2026-07-06T00:00:00.000Z - REPLACE: summarize change',
    '',
    '- Task: SVX-001'
  ].join('\n'));

  const result = runTrackingResult(repo);
  assert.equal(result.ok, false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Replace the generated/);
});

test('tracking-only commit exits zero when entry is reviewed', () => {
  const repo = setupRepo();
  appendTracking(repo, [
    '### 2026-07-06T00:00:00.000Z - Update task board',
    '',
    '- Task: SVX-002',
    '- Branch: `svx-002-task-board`',
    '- Summary: Moves a task between workflow sections.'
  ].join('\n'));

  const result = runTrackingResult(repo);
  assert.equal(result.ok, true);
});

test('branch svx-123-feature is recorded as SVX-123', () => {
  const repo = setupRepo();
  git(repo, ['checkout', '-b', 'svx-123-feature']);
  writeFeature(repo, 'feature.js');

  const result = runTrackingResult(repo);
  assert.equal(result.ok, false);

  const tracking = readFileSync(path.join(repo, 'TRACKING.md'), 'utf8');
  assert.match(tracking, /- Task: SVX-123/);
  assert.match(tracking, /- Branch: `svx-123-feature`/);
});
