#!/usr/bin/env node
/**
 * Deterministic dispatch entrypoint for the SolarGlyph skill.
 *
 * OpenClaw's `command-dispatch: tool` routes a skill slash command straight to a
 * tool with no model in the loop, and passes the raw user input as the tool's
 * `command` argument (see src/auto-reply/reply/get-reply-inline-actions.ts). That
 * makes this file the bridge for the natural-language trigger:
 *
 *   /solar-glyph-simulation 启动光伏余热仿真
 *     -> tool executes:  node trigger.cjs "启动光伏余热仿真" --command-name solar-glyph-simulation
 *
 * It accepts the Chinese trigger phrases, or pass-through flags so the same
 * entrypoint can run any preset. It always delegates to run-simulation.cjs, so
 * there is exactly one implementation of submit/poll/report.
 *
 * Exit codes: 0 success, 2 usage error, otherwise the delegate's exit code.
 */

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, 'run-simulation.cjs');

/** Trigger phrases mapped onto presets. Matching is case-insensitive substring. */
const TRIGGERS = [
  { match: ['光伏余热', '余热仿真', '余热回收仿真'], preset: 'industrial-rooftop-5mw' },
  { match: ['光伏蓄冷', '蓄冷空调'], preset: 'pv-thermal-storage-cooling' },
  { match: ['高辐照', '西北', '10mw', '10兆瓦'], preset: 'high-irradiance-10mw' },
  { match: ['小型', '1mw', '1兆瓦', '中小型厂房'], preset: 'industrial-rooftop-1mw' },
  { match: ['光伏仿真', '光伏发电仿真', '启动光伏'], preset: 'industrial-rooftop-5mw' },
];

/** Tokens that are OpenClaw dispatch metadata, not arguments for the runner. */
const META_FLAG_PREFIXES = ['--command-name', '--commandName', '--skill-name', '--skillName'];

function usage() {
  return [
    'usage: node trigger.cjs <message|flags>',
    '',
    'Accepts the OpenClaw skill trigger, for example:',
    '  node trigger.cjs "启动光伏余热仿真"',
    '  node trigger.cjs --preset industrial-rooftop-1mw',
    '',
    'Flags are forwarded to run-simulation.cjs (--preset, --capacity, --format, --report, ...).',
  ].join('\n');
}

function parse(argv) {
  const passthrough = [];
  const words = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const name = token.split('=')[0];
      if (META_FLAG_PREFIXES.includes(name)) {
        if (!token.includes('=')) i += 1;
        continue;
      }
      passthrough.push(token);
      if (!token.includes('=')) {
        const value = argv[i + 1];
        if (value !== undefined && !value.startsWith('--')) {
          passthrough.push(value);
          i += 1;
        }
      }
      continue;
    }
    words.push(token);
  }

  return { passthrough, message: words.join(' ').trim() };
}

const { passthrough, message } = parse(process.argv.slice(2));

// An explicit --preset wins over trigger matching.
const explicitPreset = passthrough.find((t) => t.startsWith('--preset'));

let args = [...passthrough];
if (!explicitPreset) {
  if (!message) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  const lower = message.toLowerCase();
  const hit = TRIGGERS.find((t) => t.match.some((m) => lower.includes(m.toLowerCase())));
  if (!hit) {
    process.stderr.write(
      `unrecognized request: "${message}"\n` +
        `known triggers: ${TRIGGERS.flatMap((t) => t.match).join(', ')}\n` +
        `or pass --preset <id> (see: node run-simulation.cjs presets)\n`,
    );
    process.exit(2);
  }
  args = [...args, '--preset', hit.preset];
  process.stderr.write(`[solarglyph] trigger matched "${message}" -> preset ${hit.preset}\n`);
}

if (!args.some((a) => a === '--format' || a.startsWith('--format='))) {
  args.push('--format', 'text');
}

const result = spawnSync(process.execPath, [RUNNER, 'run', ...args], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
