#!/usr/bin/env node
/**
 * Installs the SolarGlyph skill into an OpenClaw workspace.
 *
 * OpenClaw discovers skills at `<workspace>/skills/<name>/SKILL.md` (see
 * upstream docs/tools/skills.md). The workspace defaults to
 * `~/.openclaw/workspace`, overridable with OPENCLAW_WORKSPACE so a demo can
 * install into an isolated workspace instead of the operator's real one.
 *
 * The whole skill directory is copied, so the installed skill is self-contained:
 * SKILL.md, the bridge CLI, and the simulation core it needs at runtime.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_NAME = 'solar-glyph-simulation';
const SOURCE = path.join(ROOT, 'skills', SKILL_NAME);

function resolveWorkspace() {
  if (process.env.OPENCLAW_WORKSPACE) return path.resolve(process.env.OPENCLAW_WORKSPACE);
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) return path.join(path.resolve(stateDir), 'workspace');
  return path.join(os.homedir(), '.openclaw', 'workspace');
}

const workspace = resolveWorkspace();
const target = path.join(workspace, 'skills', SKILL_NAME);

if (!fs.existsSync(path.join(SOURCE, 'SKILL.md'))) {
  console.error(`source skill not found at ${SOURCE}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(SOURCE, target, { recursive: true });

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(target, full).split(path.sep).join('/'));
  }
})(target);

console.log(`installed skill "${SKILL_NAME}"`);
console.log(`  from : ${SOURCE}`);
console.log(`  to   : ${target}`);
console.log(`  files: ${files.length}`);
for (const f of files.sort()) console.log(`         ${f}`);
console.log('\nVerify with:  openclaw skills list');
console.log('Trigger with: 启动光伏余热仿真');
console.log(`\nStart the simulation service first:\n  node "${path.join(target, 'solarglyph-core', 'server.js')}"`);
