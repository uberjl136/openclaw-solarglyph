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
 * Steps: verify the tree is clean, verify both branches are present locally
 * (creating them from the bundle's remote-tracking refs when the clone left
 * only the checked-out branch), set origin, push both branches, then print the
 * upstream-remote and report-link follow-ups.
 *
 * The development environment this repo was built in could not reach github.com
 * over TLS, which is why publishing is a separate, explicit step here.
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

function gitOut(args) {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  return res.status === 0 ? (res.stdout || '').trim() : '';
}

console.log('repository :', REPO_URL);
console.log('branches   :', BRANCHES.join(', '));
console.log('');

// A dirty tree would push history that does not match what was built.
if (gitOut(['status', '--porcelain']) !== '') {
  console.error('working tree is not clean; commit or stash first:');
  console.error(gitOut(['status', '--porcelain']).split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}

// A clone from a bundle often has only the checked-out branch; materialise the
// others from the remote-tracking refs the bundle provides.
const localBranches = gitOut(['branch', '--format=%(refname:short)']).split('\n').filter(Boolean);
for (const branch of BRANCHES) {
  if (localBranches.includes(branch)) continue;
  const remoteRef = `origin/${branch}`;
  if (gitOut(['rev-parse', '--verify', '--quiet', remoteRef]) === '') {
    console.error(`branch "${branch}" not found locally or as ${remoteRef}; cannot push it.`);
    process.exit(1);
  }
  console.log(`creating local branch "${branch}" from ${remoteRef}`);
  if (git(['branch', '--track', branch, remoteRef]) !== 0) process.exit(1);
}

if (gitOut(['remote', 'get-url', 'origin']) !== '') {
  console.log('updating remote "origin"');
  if (git(['remote', 'set-url', 'origin', REPO_URL]) !== 0) process.exit(1);
} else {
  console.log('adding remote "origin"');
  if (git(['remote', 'add', 'origin', REPO_URL]) !== 0) process.exit(1);
}

for (const branch of BRANCHES) {
  console.log(`\n--- pushing ${branch} ---`);
  if (git(['push', '-u', 'origin', branch]) !== 0) {
    console.error(`\npush of ${branch} failed.`);
    console.error('Common causes:');
    console.error('  - the remote repository does not exist yet (create it empty on GitHub first)');
    console.error('  - authentication: use a personal access token, or configure a credential helper');
    console.error('  - the remote already has commits on this branch (force-push only if intended)');
    process.exit(1);
  }
}

console.log('\n--- optional: record which project this extends ---');
console.log('  git remote add upstream https://github.com/openclaw/openclaw.git');
console.log('  git fetch upstream');

console.log('\nDone. Next:');
console.log('  1. Put the repository URL into docs/technical-report.md (appendix 2), then: npm run report');
console.log('  2. Check the GitHub page shows both branches and the full commit history');
console.log('  3. Paste the URL into the competition platform as the 成果链接');
