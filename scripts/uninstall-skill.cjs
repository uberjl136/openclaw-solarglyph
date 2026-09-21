#!/usr/bin/env node
/**
 * Removes the SolarGlyph skill from an OpenClaw workspace.
 *
 * The counterpart to install-skill.cjs, and it resolves the workspace exactly
 * the same way, so the two never disagree about where the skill lives.
 *
 * Used when a demo needs the clean upstream baseline: with the skill removed,
 * `openclaw skills list` shows only the bundled capabilities (57 on this
 * revision), which is the state the first scene of the video documents.
 *
 *   node scripts/uninstall-skill.cjs
 *   OPENCLAW_STATE_DIR=/path/to/state node scripts/uninstall-skill.cjs
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_NAME = 'solar-glyph-simulation';

function resolveWorkspace() {
  if (process.env.OPENCLAW_WORKSPACE) return path.resolve(process.env.OPENCLAW_WORKSPACE);
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) return path.join(path.resolve(stateDir), 'workspace');
  return path.join(os.homedir(), '.openclaw', 'workspace');
}

const workspace = resolveWorkspace();
const target = path.join(workspace, 'skills', SKILL_NAME);

/** Refuse to delete anything that is not the skill directory we installed. */
if (path.basename(target) !== SKILL_NAME) {
  console.error(`refusing to remove unexpected path: ${target}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  console.log(`skill "${SKILL_NAME}" is not installed at ${target}`);
  console.log('nothing to do.');
  process.exit(0);
}

if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
  console.error(`refusing to remove ${target}: it has no SKILL.md, so it is not our skill.`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });

console.log(`removed skill "${SKILL_NAME}"`);
console.log(`  from: ${target}`);
console.log('');
console.log('OpenClaw now lists only the bundled capabilities.');
console.log('Reinstall with:  node scripts/install-skill.cjs');
