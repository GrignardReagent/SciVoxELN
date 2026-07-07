import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiSource = fs.readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const usersSource = fs.readFileSync(new URL('../public/js/views/users.js', import.meta.url), 'utf8');
const projectsSource = fs.readFileSync(new URL('../public/js/views/projects.js', import.meta.url), 'utf8');

test('users API client exposes archive lifecycle and includeArchived list option', () => {
  assert.match(apiSource, /users:\s*\([^)]*includeArchived/);
  assert.match(apiSource, /\/api\/users\$\{query\(\{\s*includeArchived\s*\}\)\}/);
  assert.match(apiSource, /archiveUser:\s*id\s*=>\s*req\('POST',\s*`\/api\/users\/\$\{id\}\/archive`/);
  assert.match(apiSource, /restoreUser:\s*id\s*=>\s*req\('POST',\s*`\/api\/users\/\$\{id\}\/restore`/);
});

test('users view hides archived users by default and can archive or restore rows', () => {
  assert.match(usersSource, /Show archived/);
  assert.match(usersSource, /id="showArchivedUsers"/);
  assert.match(usersSource, /data-archive-user/);
  assert.match(usersSource, /data-restore-user/);
  assert.match(usersSource, /api\.archiveUser/);
  assert.match(usersSource, /api\.restoreUser/);
  assert.match(usersSource, /u\.archived_at/);
  assert.match(usersSource, /const roleDisabled = archived \? 'disabled/);
  assert.match(usersSource, /Restore before changing role/);
});

test('project member rows preserve archived members with an archived badge', () => {
  assert.match(projectsSource, /m\.archived_at/);
  assert.match(projectsSource, /Archived/);
  assert.match(projectsSource, /pill danger/);
});
