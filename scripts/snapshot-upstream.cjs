#!/usr/bin/env node
/**
 * Materializes the upstream OpenClaw snapshot inside this repository.
 *
 * Run this before committing the vendor snapshot (main branch) or when
 * reproducing the repository from scratch:
 *
 *   node scripts/snapshot-upstream.cjs
 *
 * Provenance is pinned: the tarball is the official codeload archive for the
 * recorded commit, and the extraction is verified against the file count the
 * archive actually contains. The extractor is used instead of `tar.exe` because
 * the upstream tree contains NTFS-reserved names (`CLAUDE.md`) and symlinks that
 * neither `tar.exe` nor `Expand-Archive` can create on Windows.
 *
 * Nested git metadata is removed so the snapshot is plain content that the
 * outer repository tracks normally.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '..', '..');

/** Pinned upstream revision. */
const UPSTREAM = {
  repo: 'openclaw/openclaw',
  commit: 'ad1c9345f2cbbeee32fc006b963da86001bffbaa',
  branch: 'main',
  version: '2026.9.4',
  license: 'MIT',
};

const tarballUrl = `https://codeload.github.com/${UPSTREAM.repo}/tar.gz/refs/heads/${UPSTREAM.branch}`;
const cacheDir = path.join(REPO_ROOT, 'tools', '_cache');
const tarball = path.join(cacheDir, 'openclaw-main.tar.gz');
const vendorDir = path.join(ROOT, 'upstream');
const target = path.join(vendorDir, 'openclaw-main');
const reportPath = path.join(ROOT, 'reports', 'upstream-extract.json');

function run(nodeScript, args) {
  execFileSync(process.execPath, [nodeScript, ...args], { stdio: 'inherit' });
}

console.log(`upstream : ${UPSTREAM.repo}`);
console.log(`commit   : ${UPSTREAM.commit} (${UPSTREAM.branch})`);
console.log(`target   : ${target}`);

if (!fs.existsSync(tarball)) {
  console.log(`\ncache miss, downloading ${tarballUrl}`);
  run(path.join(REPO_ROOT, 'tools', 'dl.mjs'), [tarballUrl, tarball]);
} else {
  console.log(`\nusing cached archive ${tarball}`);
}

if (fs.existsSync(target)) {
  console.log('removing previous snapshot');
  fs.rmSync(target, { recursive: true, force: true });
}
fs.mkdirSync(vendorDir, { recursive: true });

console.log('extracting');
run(path.join(REPO_ROOT, 'tools', 'untar.mjs'), [tarball, target, reportPath]);

// The archive carries no .git, but guard against a repacked cache.
const nestedGit = path.join(target, '.git');
if (fs.existsSync(nestedGit)) {
  fs.rmSync(nestedGit, { recursive: true, force: true });
  console.log('removed nested .git');
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
console.log(`\nfiles extracted : ${report.extractedFiles}`);
console.log(`skipped entries : ${report.skipped.length} (symlinks — see reports/upstream-extract.json)`);
console.log(`\nsnapshot ready at upstream/openclaw-main (${UPSTREAM.repo} @ ${UPSTREAM.commit.slice(0, 7)})`);
