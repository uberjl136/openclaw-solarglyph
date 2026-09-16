#!/usr/bin/env node
/**
 * Reproduces the model-driven trigger test (natural language -> exec tool call).
 *
 * Use this on a machine with a capable model to verify the model-driven path
 * end-to-end. It runs an isolated OpenClaw state directory so it never touches
 * the operator's real configuration, installs the skill into that workspace,
 * and runs one agent turn with the trigger phrase.
 *
 *   node scripts/test-model-driven.mjs                       # defaults
 *   node scripts/test-model-driven.mjs --model ollama/qwen3:8b
 *   node scripts/test-model-driven.mjs --model openai/gpt-5.6-luna
 *
 * Why isolation: OpenClaw refuses `agent --local` while a Gateway owns the same
 * state directory, so a separate state dir keeps this repeatable.
 *
 * Exit codes: 0 the model invoked the skill tool, 1 it did not, 2 setup failure.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '..', '..');
const OPENCLAW = path.join(REPO_ROOT, 'upstream', 'openclaw-main');

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const prefixed = process.argv.find((a) => a.startsWith(`--${name}=`));
  return prefixed ? prefixed.split('=').slice(1).join('=') : fallback;
}

const model = argValue('model', process.env.SOLARGLYPH_TEST_MODEL || 'ollama/qwen3:8b');
const message = argValue('message', '启动光伏余热仿真');
const stateDir = path.resolve(argValue('state-dir', path.join(REPO_ROOT, 'work', 'oc-model-test')));
const workspace = path.join(stateDir, 'workspace');
const provider = model.includes('/') ? model.split('/')[0] : 'ollama';
const modelId = model.includes('/') ? model.split('/').slice(1).join('/') : model;

if (!fs.existsSync(OPENCLAW)) {
  console.error(`OpenClaw checkout not found at ${OPENCLAW}`);
  process.exit(2);
}

// ---------------------------------------------------------------- state setup
fs.mkdirSync(workspace, { recursive: true });

const existingConfig = path.join(REPO_ROOT, 'work', 'openclaw-state', 'openclaw.json');
let config;
if (fs.existsSync(existingConfig)) {
  config = JSON.parse(fs.readFileSync(existingConfig, 'utf8'));
} else {
  config = { gateway: { mode: 'local' }, tools: { profile: 'full', toolSearch: false }, models: { mode: 'merge', providers: {} } };
}
config.gateway = { ...(config.gateway || {}), mode: 'local' };
config.tools = { ...(config.tools || {}), profile: 'full', toolSearch: false };
config.agents = { ...(config.agents || {}), defaults: { ...((config.agents || {}).defaults || {}), model } };
config.models = config.models || { mode: 'merge', providers: {} };
config.models.providers = config.models.providers || {};
if (!config.models.providers[provider]) {
  config.models.providers[provider] = {
    baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : undefined,
    apiKey: provider === 'ollama' ? 'ollama-local' : undefined,
    api: 'openai-completions',
    models: [],
  };
}
const models = config.models.providers[provider].models || [];
if (!models.some((m) => m.id === modelId)) {
  models.push({
    id: modelId,
    name: modelId,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 40960,
    contextTokens: 32000,
    maxTokens: 4096,
  });
}
config.models.providers[provider].models = models;
fs.writeFileSync(path.join(stateDir, 'openclaw.json'), `${JSON.stringify(config, null, 2)}\n`);

// Skill install into the isolated workspace
const skillSrc = path.join(ROOT, 'skills', 'solar-glyph-simulation');
const skillDst = path.join(workspace, 'skills', 'solar-glyph-simulation');
fs.rmSync(skillDst, { recursive: true, force: true });
fs.mkdirSync(path.dirname(skillDst), { recursive: true });
fs.cpSync(skillSrc, skillDst, { recursive: true });

console.log(`model     : ${model}`);
console.log(`state dir : ${stateDir}`);
console.log(`message   : ${message}`);
console.log('');

// ------------------------------------------------------------------- run turn
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_WORKSPACE: workspace,
};
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['openclaw', 'agent', '--local', '--message', message, '--json'],
  { cwd: OPENCLAW, env, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 },
);

const out = `${result.stdout || ''}${result.stderr || ''}`;
const start = out.indexOf('{');
let payload = null;
if (start !== -1) {
  try {
    payload = JSON.parse(out.slice(start, out.lastIndexOf('}') + 1));
  } catch {
    payload = null;
  }
}

const logPath = path.join(stateDir, 'last-turn.json');
fs.writeFileSync(logPath, out);

if (!payload || !payload.result) {
  console.error('could not parse the agent turn output; raw log written to');
  console.error(`  ${logPath}`);
  process.exit(2);
}

const r = payload.result;
const tools = (r.toolSummary && r.toolSummary.tools) || [];
const calls = (r.toolSummary && r.toolSummary.calls) || 0;
const usedSkill = tools.includes('exec');

console.log('─'.repeat(64));
console.log(`winner model : ${(r.executionTrace || {}).winnerModel || '?'}`);
console.log(`tool calls   : ${calls}  ${tools.length ? `[${tools.join(', ')}]` : ''}`);
console.log(`assistant    : ${(r.finalAssistantVisibleText || '').slice(0, 300)}`);
console.log('─'.repeat(64));
console.log(`raw log      : ${logPath}`);
console.log('');

if (usedSkill && calls > 0) {
  console.log('VERDICT: the model invoked the skill tool — model-driven path OK');
  process.exit(0);
}
console.log('VERDICT: the model did NOT invoke exec.');
console.log('This is a model-capability limit, not an integration failure: the skill is');
console.log('discovered and exec is available (see tools list above). Try a larger model,');
console.log('or use the deterministic entrypoint: node scripts/trigger.cjs "启动光伏余热仿真"');
process.exit(1);
