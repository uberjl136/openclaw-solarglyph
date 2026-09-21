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
const defaultMessage = [
  '启动光伏余热仿真。',
  '',
  '请执行 solar-glyph-simulation 技能。用 exec 工具运行下面这条命令（路径必须完全一致，',
  '技能目录是 skills/solar-glyph-simulation）：',
  '',
  'node skills/solar-glyph-simulation/scripts/trigger.cjs',
  '',
  '命令会返回仿真结果，然后把年发电量、余热年回收热量、年减排 CO2 汇报给我。',
].join('\n');
const message = argValue('message', defaultMessage);
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
// The lean recipe that makes small local models work (see
// docs/verification-evidence.md): no bootstrap context injection, and a tool
// surface limited to what the skill flow actually needs.
config.tools = { ...(config.tools || {}), profile: 'full', toolSearch: false, allow: ['read', 'exec'] };
config.agents = {
  ...(config.agents || {}),
  defaults: {
    ...((config.agents || {}).defaults || {}),
    model,
    skipBootstrap: true,
    contextInjection: 'never',
  },
};
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
// The message goes through a file: multiline prompts and Windows shell quoting
// do not mix, and OpenClaw accepts --message-file directly.
const messageFile = path.join(stateDir, 'task.md');
fs.writeFileSync(messageFile, `${message}\n`);

// pnpm may live in a repo-local prefix rather than the system PATH, so prepend
// both that prefix and this checkout's git bin directory for the child process.
const localPrefix = path.join(REPO_ROOT, 'tools', 'npm-global');
const gitCmd = path.join(REPO_ROOT, 'tools', 'git', 'cmd');
const env = {
  ...process.env,
  PATH: [localPrefix, gitCmd, process.env.PATH].filter(Boolean).join(path.delimiter),
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_WORKSPACE: workspace,
};
// Invoke the same entrypoint `pnpm openclaw` uses, but directly through node:
// the repository path contains a space, and spawning `pnpm.cmd` needs a shell,
// which would split `--message-file <path with space>` into two arguments.
const result = spawnSync(
  process.execPath,
  [path.join(OPENCLAW, 'scripts', 'run-node.mjs'), 'agent', '--local', '--message-file', messageFile, '--json'],
  { cwd: OPENCLAW, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const out = `${result.stdout || ''}${result.stderr || ''}`;
const logPath = path.join(stateDir, 'last-turn.json');
fs.writeFileSync(logPath, out);

/**
 * The CLI prints progress lines around the JSON payload, so scan candidate
 * objects and keep the first balanced one that carries a `result`.
 */
function extractPayload(text) {
  for (let idx = text.indexOf('{'); idx !== -1; idx = text.indexOf('{', idx + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = idx; i < text.length; i += 1) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const candidate = JSON.parse(text.slice(idx, i + 1));
            if (candidate && (candidate.result || candidate.payloads || candidate.successfulToolNames)) {
              return candidate;
            }
          } catch {
            // not the payload; keep scanning
          }
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Two payload shapes are observed across CLI builds: a wrapper carrying
 * `result`, and a flat run report carrying `payloads` plus `successfulToolNames`.
 * Accept either, and normalise the fields this script reports on.
 */
function normalize(payload) {
  if (payload && payload.result) {
    const r = payload.result;
    return {
      model: (r.executionTrace || {}).winnerModel,
      tools: (r.toolSummary && r.toolSummary.tools) || [],
      calls: (r.toolSummary && r.toolSummary.calls) || 0,
      failures: (r.toolSummary && r.toolSummary.failures) || 0,
      text: r.finalAssistantVisibleText || '',
    };
  }
  if (payload && (payload.payloads || payload.successfulToolNames)) {
    const tools = payload.successfulToolNames || [];
    const texts = (payload.payloads || []).map((p) => (typeof p === 'string' ? p : p && p.text)).filter(Boolean);
    return {
      model: (payload.meta && payload.meta.model) || (payload.effective && payload.effective.model),
      tools,
      calls: tools.length,
      failures: 0,
      text: texts.join('\n\n'),
    };
  }
  return null;
}

const payload = extractPayload(out);
const normalized = normalize(payload);

if (!normalized) {
  console.error('could not parse the agent turn output; raw log written to');
  console.error(`  ${logPath}`);
  process.exit(2);
}

const { tools, calls, failures, text } = normalized;
const invokedExec = tools.includes('exec') || /node\s+skills\/solar-glyph-simulation/.test(out);
// Real simulation evidence: the service logs and the returned metrics only
// appear when the skill actually ran end-to-end.
const ranSimulation =
  /\[solarglyph\] (trigger matched|submitted job)/.test(out) ||
  /annualGenerationKwh=|万kWh/.test(out) ||
  /succeeded\s+100%/.test(out);

console.log('─'.repeat(64));
console.log(`winner model  : ${normalized.model || '?'}`);
console.log(`tool calls    : ${calls}  ${tools.length ? `[${tools.join(', ')}]` : ''}  failures: ${failures}`);
console.log(`simulation ran: ${ranSimulation ? 'YES' : 'no'}`);
console.log(`assistant     : ${(text || '').slice(0, 400)}`);
console.log('─'.repeat(64));
console.log(`raw log       : ${logPath}`);
console.log('');

if (invokedExec && ranSimulation) {
  console.log('VERDICT: model-driven path OK — the model called exec and the simulation ran');
  process.exit(0);
}
if (invokedExec) {
  console.log('VERDICT: PARTIAL — the model called exec but no simulation output was observed.');
  console.log(`Inspect ${logPath} to see which command it ran.`);
  process.exit(1);
}
console.log('VERDICT: the model did NOT call exec.');
console.log('The skill is discovered and exec is available (see the tool list above);');
console.log('this points at model capability. Try a larger model, or use the');
console.log('deterministic entrypoint: node scripts/trigger.cjs "启动光伏余热仿真"');
process.exit(1);
