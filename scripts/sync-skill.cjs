#!/usr/bin/env node
/**
 * Copies the canonical runtime files into the installable skill package under
 * `skills/solar-glyph-simulation/`.
 *
 * Why copies instead of symlinks: the skill bundle must survive being copied or
 * zipped into an OpenClaw workspace (`~/.openclaw/workspace/skills/...`), and
 * symlinks neither survive archiving on Windows nor are permitted without
 * elevation. `verify-skill.cjs` enforces that the copies stay byte-identical.
 *
 * Run after editing anything in `solarglyph-core/` or `scripts/`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'solar-glyph-simulation');

/** source (relative to repo root) -> destination (relative to skill dir) */
const FILES = [
  ['scripts/run-simulation.cjs', 'scripts/run-simulation.cjs'],
  ['scripts/trigger.cjs', 'scripts/trigger.cjs'],
  ['solarglyph-core/engine.js', 'solarglyph-core/engine.js'],
  ['solarglyph-core/server.js', 'solarglyph-core/server.js'],
  ['solarglyph-core/presets.js', 'solarglyph-core/presets.js'],
];

let copied = 0;
for (const [from, to] of FILES) {
  const src = path.join(ROOT, from);
  const dst = path.join(SKILL_DIR, to);
  if (!fs.existsSync(src)) {
    console.error(`missing source: ${from}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied += 1;
  console.log(`synced ${from} -> skills/solar-glyph-simulation/${to}`);
}
console.log(`\n${copied} file(s) synced into the skill package.`);
