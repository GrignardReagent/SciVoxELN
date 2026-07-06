#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TRACKING_FILE = 'TRACKING.md';
const PLACEHOLDER_SUMMARY = 'REPLACE: summarize change';
const PLACEHOLDER_HEADING_RE = /^### .+ - REPLACE: summarize change$/m;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe']
  }).trim();
}

function gitMaybe(args, options = {}) {
  try {
    return git(args, options);
  } catch {
    return '';
  }
}

function repoRoot() {
  const root = gitMaybe(['rev-parse', '--show-toplevel']);
  if (!root) {
    throw new Error('Not inside a git repository.');
  }
  return root;
}

function stagedFiles(root) {
  return gitMaybe(['diff', '--cached', '--name-only', '--diff-filter=ACMRTD'], { cwd: root })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function stagedTrackingContent(root) {
  return gitMaybe(['show', `:${TRACKING_FILE}`], { cwd: root });
}

function trackingIsDeleted(root) {
  return gitMaybe(['diff', '--cached', '--name-status', '--', TRACKING_FILE], { cwd: root })
    .split('\n')
    .some(line => line.startsWith('D'));
}

function currentBranch(root) {
  return gitMaybe(['branch', '--show-current'], { cwd: root })
    || gitMaybe(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
    || 'detached';
}

function inferTaskId(branch) {
  const match = branch.match(/\bsvx[-/_]?(\d{1,6})\b/i);
  if (!match) return 'Unassigned';
  return `SVX-${match[1].padStart(3, '0')}`;
}

function draftSignature(files) {
  return createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
}

function formatDraft({ branch, files }) {
  const now = new Date().toISOString();
  const task = inferTaskId(branch);
  const signature = draftSignature(files);
  const fileList = files.map(file => `  - \`${file}\``).join('\n') || '  - (none)';
  return [
    `### ${now} - ${PLACEHOLDER_SUMMARY}`,
    '',
    `<!-- tracking-draft:${signature} -->`,
    `- Task: ${task}`,
    `- Branch: \`${branch}\``,
    '- Summary: Replace this draft with a concise description before staging.',
    '- Files:',
    fileList,
    ''
  ].join('\n');
}

function insertIntoChangeLog(content, entry) {
  const headingRe = /^## Change Log\s*$/m;
  const match = headingRe.exec(content);
  if (!match) {
    const prefix = content.endsWith('\n') ? content : `${content}\n`;
    return `${prefix}\n## Change Log\n\n${entry}`;
  }

  let insertAt = match.index + match[0].length;
  if (content[insertAt] === '\r') insertAt += 1;
  if (content[insertAt] === '\n') insertAt += 1;
  while (content.slice(insertAt, insertAt + 1) === '\n') {
    insertAt += 1;
  }
  return `${content.slice(0, insertAt)}${entry}\n${content.slice(insertAt)}`;
}

function appendDraft(root, files) {
  const trackingPath = path.join(root, TRACKING_FILE);
  const branch = currentBranch(root);
  const signature = draftSignature(files);
  const marker = `<!-- tracking-draft:${signature} -->`;
  const existing = existsSync(trackingPath) ? readFileSync(trackingPath, 'utf8') : '';

  if (existing.includes(marker)) {
    return { appended: false, marker };
  }

  const draft = formatDraft({ branch, files });
  const next = insertIntoChangeLog(existing, draft);
  writeFileSync(trackingPath, next);
  return { appended: true, marker };
}

function hasPlaceholder(content) {
  return PLACEHOLDER_HEADING_RE.test(content);
}

function commandInstall(root) {
  git(['config', 'core.hooksPath', '.githooks'], { cwd: root });
  console.log('SciVoxELN workflow hooks installed: core.hooksPath=.githooks');
}

function commandAppendDraft(root) {
  const files = stagedFiles(root).filter(file => file !== TRACKING_FILE);
  if (files.length === 0) {
    console.log('No staged non-tracking changes found.');
    return 0;
  }

  const result = appendDraft(root, files);
  console.log(result.appended
    ? `Appended draft Change Log entry to ${TRACKING_FILE}.`
    : `Draft Change Log entry already exists in ${TRACKING_FILE}.`);
  return 0;
}

function commandCheck(root) {
  const staged = stagedFiles(root);
  if (staged.length === 0) return 0;

  const nonTracking = staged.filter(file => file !== TRACKING_FILE);
  const trackingStaged = staged.includes(TRACKING_FILE);

  if (trackingStaged) {
    if (trackingIsDeleted(root)) {
      console.error(`${TRACKING_FILE} cannot be deleted in a tracked change.`);
      return 1;
    }

    const content = stagedTrackingContent(root);
    if (hasPlaceholder(content)) {
      console.error(`Replace the generated "${PLACEHOLDER_SUMMARY}" heading in ${TRACKING_FILE} before committing.`);
      return 1;
    }
  }

  if (nonTracking.length === 0) return 0;

  if (!trackingStaged) {
    const result = appendDraft(root, nonTracking);
    console.error(result.appended
      ? `Added a draft Change Log entry to ${TRACKING_FILE}.`
      : `A draft Change Log entry already exists in ${TRACKING_FILE}.`);
    console.error(`Review it, replace the generated summary, stage ${TRACKING_FILE}, then commit again.`);
    return 1;
  }

  return 0;
}

function main() {
  const command = process.argv[2] || 'check';
  const root = repoRoot();

  switch (command) {
    case 'install':
      commandInstall(root);
      return 0;
    case 'append-draft':
      return commandAppendDraft(root);
    case 'check':
      return commandCheck(root);
    case 'help':
    case '--help':
    case '-h':
      console.log('Usage: node scripts/tracking.js [install|check|append-draft]');
      return 0;
    default:
      console.error(`Unknown tracking command: ${command}`);
      console.error('Usage: node scripts/tracking.js [install|check|append-draft]');
      return 1;
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
