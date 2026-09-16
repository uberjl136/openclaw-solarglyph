#!/usr/bin/env node
/**
 * Verifies the installable skill package is intact and identical to its sources.
 *
 * Fails (exit 1) when any of these do not hold:
 *   1. SKILL.md exists and carries the frontmatter fields OpenClaw requires
 *      (`name`, `description`) with a name matching the directory.
 *   2. Every runtime file inside the skill matches the canonical source bytes.
 *   3. The skill's own dependencies resolve from inside the skill directory,
 *      i.e. the copy is genuinely self-contained.
 *   4. The CLI answers `--help`-style usage and the engine returns a deterministic
 *      result for a fixed input (identical output across two runs).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'solar-glyph-simulation');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

const FILES = [
  ['scripts/run-simulation.cjs', 'scripts/run-simulation.cjs'],
  ['scripts/trigger.cjs', 'scripts/trigger.cjs'],
  ['solarglyph-core/engine.js', 'solarglyph-core/engine.js'],
  ['solarglyph-core/server.js', 'solarglyph-core/server.js'],
  ['solarglyph-core/presets.js', 'solarglyph-core/presets.js'],
];

const failures = [];
const checks = [];
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 1. SKILL.md frontmatter -----------------------------------------------------
if (!fs.existsSync(SKILL_MD)) {
  failures.push('SKILL.md is missing');
} else {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    failures.push('SKILL.md has no YAML frontmatter block');
  } else {
    const nameMatch = /^name:\s*(.+)$/m.exec(fm[1]);
    const descMatch = /^description:\s*(.+)$/m.exec(fm[1]);
    const declared = nameMatch ? nameMatch[1].trim() : null;
    if (!declared) failures.push('SKILL.md frontmatter is missing `name`');
    if (!descMatch) failures.push('SKILL.md frontmatter is missing `description`');
    if (declared && declared !== path.basename(SKILL_DIR)) {
      failures.push(`frontmatter name "${declared}" does not match directory "${path.basename(SKILL_DIR)}"`);
    }
    if (declared && !/^[a-z0-9-]+$/.test(declared)) {
      failures.push(`frontmatter name "${declared}" must be lowercase letters, digits and hyphens`);
    }
    if (descMatch) {
      const desc = descMatch[1].replace(/^["']|["']$/g, '');
      if (desc.length > 160) failures.push(`description is ${desc.length} chars (OpenClaw docs recommend < 160)`);
      checks.push(`SKILL.md name=${declared} description=${desc.length} chars`);
    }
    for (const token of ['启动光伏余热仿真', '/v1/simulations', '{baseDir}']) {
      if (!text.includes(token)) failures.push(`SKILL.md should mention "${token}"`);
    }
  }
}

// 2. byte-identical copies ----------------------------------------------------
for (const [from, to] of FILES) {
  const src = path.join(ROOT, from);
  const dst = path.join(SKILL_DIR, to);
  if (!fs.existsSync(dst)) {
    failures.push(`skill copy missing: ${to} (run \`npm run sync-skill\`)`);
    continue;
  }
  if (sha(src) !== sha(dst)) {
    failures.push(`skill copy out of date: ${to} (run \`npm run sync-skill\`)`);
  }
}
if (!failures.length) checks.push(`${FILES.length} runtime files byte-identical to sources`);

// 3. self-contained load ------------------------------------------------------
try {
  const enginePath = path.join(SKILL_DIR, 'solarglyph-core', 'engine.js');
  const loaded = require(enginePath);
  if (typeof loaded.runSimulation !== 'function') failures.push('engine.js does not export runSimulation');
  else checks.push('skill-local engine.js loads and exports runSimulation');
} catch (err) {
  failures.push(`skill-local engine failed to load: ${err.message}`);
}

// 4. determinism --------------------------------------------------------------
try {
  const { runSimulation } = require(path.join(SKILL_DIR, 'solarglyph-core', 'engine.js'));
  const { applyPreset } = require(path.join(SKILL_DIR, 'solarglyph-core', 'presets.js'));
  const body = applyPreset({ preset: 'industrial-rooftop-5mw' }).request;
  const a = JSON.stringify(runSimulation(body));
  const b = JSON.stringify(runSimulation(body));
  if (a !== b) failures.push('engine output is not deterministic for identical input');
  else checks.push('engine output deterministic across runs');
} catch (err) {
  failures.push(`determinism check failed: ${err.message}`);
}

// 5. deterministic trigger mapping -------------------------------------------
// Asserts the dispatch entrypoint rejects unknown requests; the live run is
// attempted below once the synchronous checks are done.
try {
  const trigger = path.join(SKILL_DIR, 'scripts', 'trigger.cjs');
  let status = 0;
  try {
    execFileSync(process.execPath, [trigger, 'totally-unknown-request'], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (err) {
    status = typeof err.status === 'number' ? err.status : -1;
  }
  if (status === 2) checks.push('trigger.cjs rejects unknown requests with exit code 2');
  else failures.push(`trigger.cjs expected exit 2 for an unknown request, got ${status}`);
} catch (err) {
  failures.push(`trigger.cjs check failed: ${err.message}`);
}

// 6. CLI usage ----------------------------------------------------------------
// Uses inherited stdio: capturing a child's piped output is blocked in some
// sandboxes (spawn EPERM), and only the exit status matters here.
try {
  const cli = path.join(SKILL_DIR, 'scripts', 'run-simulation.cjs');
  let status = 0;
  try {
    execFileSync(process.execPath, [cli, 'bogus-command'], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (err) {
    status = typeof err.status === 'number' ? err.status : -1;
  }
  if (status === 2) checks.push('CLI rejects unknown commands with exit code 2');
  else failures.push(`CLI smoke failed: expected exit 2 for an unknown command, got ${status}`);
} catch (err) {
  failures.push(`CLI smoke failed: ${err.message}`);
}

// 7. live end-to-end trigger (only when the simulation service is listening) --
function serviceListening() {
  return new Promise((resolve) => {
    const req = require('node:http').request(
      { host: '127.0.0.1', port: Number(process.env.SOLARGLYPH_PORT || 8787), path: '/v1/health', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function liveTriggerCheck() {
  if (!(await serviceListening())) {
    checks.push('trigger.cjs live run skipped (simulation service not listening)');
    return;
  }
  let runStatus = 0;
  try {
    execFileSync(process.execPath, [path.join(SKILL_DIR, 'scripts', 'trigger.cjs'), '启动光伏余热仿真'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch (err) {
    runStatus = typeof err.status === 'number' ? err.status : -1;
  }
  if (runStatus === 0) checks.push('trigger.cjs ran "启动光伏余热仿真" end-to-end against the live service');
  else failures.push(`trigger.cjs live run failed with exit code ${runStatus}`);
}

liveTriggerCheck().then(() => {
  console.log('SolarGlyph skill package verification');
  console.log('─'.repeat(56));
  for (const c of checks) console.log(`  PASS  ${c}`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('─'.repeat(56));
  console.log(failures.length ? `${failures.length} check(s) failed` : `all ${checks.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
});
