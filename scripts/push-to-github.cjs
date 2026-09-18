/**
 * Push this repository to your own GitHub repository.
 *
 * Run this on a machine that can reach github.com (your laptop), after cloning
 * the bundle:
 *
 *   git clone -b feature/solar-glyph-simulation openclaw-solarglyph.bundle openclaw-solarglyph
 *   cd openclaw-solarglyph
 *   node scripts/push-to-github.cjs https://github.com/<you>/<repo>.git
 *
 * It pushes both branches and prints the next steps, including how to record the
 * upstream link so reviewers can confirm the lineage.
 *
 * The development environment this repo was built in could not reach github.com
 * over TLS, which is why the push is a separate, explicit step here.
 */

'use strict';

const { spawnSync } = require('node:child_process');

const REPO_URL = process.argv[2];
const BRANCHES = ['main', 'feature/solar-glyph-simulation'];

if (!REPO_URL || !/^(https:\/\/|git@)/.test(REPO_URL)) {
  console.error('usage: node scripts/push-to-github.cjs <repo-url>');
  console.error('  example: node scripts/push-to-github.cjs https://github.com/yourname/openclaw-solarglyph.git');
  console.error('  example: node scripts/push-to-github.cjs git@github.com:yourname/openclaw-solarglyph.git');
  process.exit(2);
}

function git(args, opts = {}) {
  const res = spawnSync('git', args, { stdio: 'inherit', ...opts });
  return res.status ?? 1;
}

console.log('repository :', REPO_URL);
console.log('branches   :', BRANCHES.join(', '));
console.log('');

// Refuse to run from a dirty tree so the pushed history matches what was built.
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if ((status.stdout || '').trim() !== '') {
  console.error('working tree is not clean; commit or stash first:');
  console.error((status.stdout || '').split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}

if (git(['remote', 'get-url', 'origin']) !== 0) {
  console.log('adding remote "origin"');
  if (git(['remote', 'add', 'origin', REPO_URL]) !== 0) process.exit(1);
} else {
  console.log('updating remote "origin"');
  if (git(['remote', 'set-url', 'origin', REPO_URL]) !== 0) process.exit(1);
}

for (const branch of BRANCHES) {
  console.log(`\n--- pushing ${branch} ---`);
  if (git(['push', '-u', 'origin', branch]) !== 0) {
    console.error(`\npush of ${branch} failed.`);
    console.error('Common causes:');
    console.error('  - the remote repository does not exist yet (create it on GitHub first)');
    console.error('  - authentication: use a personal access token, or a credential helper');
    console.error('  - the remote already has commits on this branch (use --force-with-lease if intended)');
    process.exit(1);
  }
}

console.log('\n--- optional: record the upstream project ---');
console.log('  git remote add upstream https://github.com/openclaw/openclaw.git');
console.log('  git fetch upstream');
console.log('This lets a reviewer confirm which project this work extends.');

console.log('\nDone. Next:');
console.log('  1. Put the repository URL into docs/technical-report.md (appendix 2) and rebuild: npm run report');
console.log('  2. Check the GitHub page shows both branches and the commit history');
console.log('  3. Paste the URL into the competition platform as the 成果链接');
