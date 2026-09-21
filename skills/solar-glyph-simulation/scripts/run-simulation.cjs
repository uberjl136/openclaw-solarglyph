#!/usr/bin/env node
/**
 * solarglyph — command-line bridge between the OpenClaw agent and the
 * SolarGlyph simulation service.
 *
 * The agent calls this from the `exec` tool; every subcommand is a thin HTTP
 * client over `solarglyph-core/server.js`. Keeping the agent on this CLI (rather
 * than raw curl) means progress polling, retries, reporting, and machine-readable
 * output are implemented once, in a file that ships inside the skill.
 *
 * Commands
 *   run       submit + poll to completion + print (and optionally write) results
 *   submit    submit a job and return its id immediately
 *   status    poll one job
 *   result    fetch a finished job's result
 *   presets   list scenario presets
 *   health    service liveness and model metadata
 *
 * Usage examples
 *   node run-simulation.cjs run --preset industrial-rooftop-5mw --format text
 *   node run-simulation.cjs run --preset high-irradiance-10mw --report out.md
 *   node run-simulation.cjs run --input design.json --format json
 *   node run-simulation.cjs status <job-id>
 *
 * Exit codes: 0 success, 1 runtime/validation failure, 2 usage error.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = process.env.SOLARGLYPH_URL || 'http://127.0.0.1:8787';
const POLL_INTERVAL_MS = Number(process.env.SOLARGLYPH_POLL_MS || 1000);
const POLL_TIMEOUT_MS = Number(process.env.SOLARGLYPH_TIMEOUT_MS || 120000);

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        args[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          args[token.slice(2)] = true;
        } else {
          args[token.slice(2)] = next;
          i += 1;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP helpers with actionable errors
// ---------------------------------------------------------------------------

async function request(baseUrl, method, urlPath, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const hint =
      err.cause && /ECONNREFUSED/.test(String(err.cause.code || err.cause.message))
        ? `\nThe SolarGlyph simulation service is not reachable at ${baseUrl}.\nStart it first:\n  node solarglyph-core/server.js`
        : '';
    const error = new Error(`request to ${baseUrl}${urlPath} failed: ${err.message}${hint}`);
    error.exitCode = 1;
    throw error;
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const detail = payload && payload.errors ? payload.errors.join('; ') : (payload && payload.error) || res.statusText;
    const error = new Error(`HTTP ${res.status} from ${method} ${urlPath}: ${detail}`);
    error.payload = payload;
    error.exitCode = 1;
    throw error;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// request body assembly
// ---------------------------------------------------------------------------

function loadRequestBody(args) {
  let body = {};

  if (typeof args.input === 'string') {
    const file = path.resolve(args.input);
    if (!fs.existsSync(file)) {
      const error = new Error(`--input file not found: ${file}`);
      error.exitCode = 2;
      throw error;
    }
    body = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  if (typeof args.preset === 'string') body.preset = args.preset;
  if (typeof args.label === 'string') body.label = args.label;

  // Convenience overrides so the agent does not have to build nested JSON.
  const setPath = (dotted, value) => {
    if (value === undefined) return;
    const parts = dotted.split('.');
    let node = body;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  };

  const numeric = (v) => (v === undefined ? undefined : Number(v));
  setPath('site.latDeg', numeric(args.lat));
  setPath('site.annualGhiKwhM2', numeric(args.ghi));
  setPath('array.capacityKwp', numeric(args.capacity));
  setPath('array.tiltDeg', numeric(args.tilt));
  setPath('array.azimuthDeg', numeric(args.azimuth));
  setPath('array.specificYieldKwhPerKwp', numeric(args['specific-yield']));

  if (body.preset === undefined && Object.keys(body).length === 0) {
    body.preset = 'industrial-rooftop-5mw';
  }
  return body;
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

const nf = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const wan = (kwh) => (Number.isFinite(kwh) ? `${(kwh / 10000).toFixed(1)} 万kWh` : 'n/a');

function formatText(payload) {
  const r = payload.result;
  const s = r.summary;
  const lines = [];
  const rule = '─'.repeat(64);

  lines.push(rule);
  lines.push(`SolarGlyph 光伏余热仿真结果  (job ${payload.id})`);
  lines.push(rule);
  lines.push(`场景          ${payload.inputs.label || r.inputs.array.capacityKwp + ' kWp'}`);
  lines.push(`站点          lat ${nf(r.inputs.site.latDeg, 2)}°  水平面年辐照 ${nf(r.inputs.site.annualGhiKwhM2, 0)} kWh/m²`);
  lines.push(`阵列          ${nf(s.pvCapacityKwp, 0)} kWp  倾角 ${nf(r.inputs.array.tiltDeg, 0)}°  方位 ${nf(r.inputs.array.azimuthDeg, 0)}°`);
  lines.push('');
  lines.push(`倾斜面年辐照   ${nf(s.annualPoaKwhM2, 1)} kWh/m²   (相对水平面 ${nf(r.pv.irradiance.poaGainPct, 1)}%)`);
  lines.push(`年发电量       ${wan(s.annualGenerationKwh)}   (${nf(s.annualGenerationMwh, 0)} MWh)`);
  lines.push(`单位发电量     ${nf(s.specificYieldKwhPerKwp, 1)} kWh/kWp·年`);
  lines.push(
    `代表日        第 ${r.representativeDay.month} 月：日发电 ${nf(r.representativeDay.dailyAcKwh, 0)} kWh，峰值 ${nf(
      r.representativeDay.peakAcKw,
      0,
    )} kW`,
  );
  lines.push('');
  lines.push(`余热可利用      ${nf(r.wasteHeat.totalAvailableThermalKw, 0)} kW（${r.wasteHeat.streams.length} 路热源）`);
  lines.push(`余热回收功率    ${nf(r.wasteHeat.totalRecoveredThermalKw, 0)} kW`);
  lines.push(`年回收热量      ${wan(s.annualRecoveredHeatKwh)}   (${nf(s.annualRecoveredHeatGj, 0)} GJ)`);
  lines.push(`ORC 年发电      ${wan(s.annualOrcElectricityKwh)}`);
  lines.push(`可用年供热量    ${wan(r.wasteHeat.annualUsableHeatKwh)}`);
  lines.push('');
  lines.push(`蓄热储能量      ${nf(r.thermalStorage.storedEnergyKwh, 0)} kWh   24h 热损率 ${nf(r.thermalStorage.loss24hRatePct, 2)}%`);
  lines.push(`综合可用能量    ${wan(s.combinedUsefulEnergyKwh)}`);
  lines.push(`年减排 CO₂      ${nf(s.co2AvoidedTonnes, 1)} t`);
  if (s.coolingCoverageRate !== null) {
    lines.push(`冷量覆盖率      ${nf(s.coolingCoverageRate * 100, 1)}%`);
  }
  lines.push(rule);
  lines.push('热源明细:');
  for (const st of r.wasteHeat.streams) {
    lines.push(
      `  • ${st.name.padEnd(22)} 可用 ${nf(st.availableThermalKw, 1).padStart(7)} kW → 回收 ${nf(
        st.recoveredThermalKw,
        1,
      ).padStart(7)} kW  年 ${wan(st.annualRecoveredHeatKwh)}`,
    );
  }
  lines.push(rule);
  return lines.join('\n');
}

function formatMarkdown(payload) {
  const r = payload.result;
  const s = r.summary;
  const rows = [
    ['PV 装机容量', `${nf(s.pvCapacityKwp, 0)} kWp`],
    ['倾斜面年辐照量', `${nf(s.annualPoaKwhM2, 1)} kWh/m²`],
    ['年发电量', `${wan(s.annualGenerationKwh)}（${nf(s.annualGenerationMwh, 0)} MWh）`],
    ['单位发电量', `${nf(s.specificYieldKwhPerKwp, 1)} kWh/kWp·年`],
    ['余热年回收热量', `${wan(s.annualRecoveredHeatKwh)}（${nf(s.annualRecoveredHeatGj, 0)} GJ）`],
    ['ORC 年发电量', wan(s.annualOrcElectricityKwh)],
    ['综合可用能量', wan(s.combinedUsefulEnergyKwh)],
    ['年减排 CO₂', `${nf(s.co2AvoidedTonnes, 1)} t`],
    ['蓄热 24h 热损率', `${nf(r.thermalStorage.loss24hRatePct, 2)} %`],
    ['代表日峰值功率', `${nf(r.representativeDay.peakAcKw, 0)} kW`],
  ];

  return [
    `# SolarGlyph 光伏余热仿真报告`,
    '',
    `- 仿真任务 ID：\`${payload.id}\``,
    `- 场景：${payload.inputs.label || '自定义'}`,
    `- 完成时间：${payload.finishedAt}（耗时 ${payload.durationMs} ms）`,
    `- 站点：纬度 ${nf(r.inputs.site.latDeg, 2)}°，水平面年辐照 ${nf(r.inputs.site.annualGhiKwhM2, 0)} kWh/m²`,
    `- 阵列：倾角 ${nf(r.inputs.array.tiltDeg, 0)}°，方位 ${nf(r.inputs.array.azimuthDeg, 0)}°`,
    '',
    '## 关键指标',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## 余热热源明细',
    '',
    '| 热源 | 可用热功率 (kW) | 回收率 | 年回收热量 (kWh) |',
    '| --- | ---: | ---: | ---: |',
    ...r.wasteHeat.streams.map(
      (st) =>
        `| ${st.name} | ${nf(st.availableThermalKw, 1)} | ${nf(st.recoveryEfficiency * 100, 0)}% | ${nf(
          st.annualRecoveredHeatKwh,
          0,
        )} |`,
    ),
    '',
    '## 代表日逐时发电曲线',
    '',
    '| 时刻 | POA (W/m²) | 环境温度 (°C) | 组件温度 (°C) | AC 功率 (kW) |',
    '| ---: | ---: | ---: | ---: | ---: |',
    ...r.representativeDay.series.map(
      (h) =>
        `| ${String(h.hour).padStart(2, '0')}:00 | ${nf(h.poaWm2, 0)} | ${nf(h.ambientC, 1)} | ${nf(
          h.cellTemperatureC,
          1,
        )} | ${nf(h.acPowerKw, 1)} |`,
    ),
    '',
    '> 计算模型来源：SolarGlyph 工程算法（太阳位置/倾斜面几何/辐照—发电量/储热/逆变器与线路）',
    '> 余热回收模块为本团队扩展实现。详见 `docs/solarglyph-algorithm-provenance.md`。',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function runSimulation(baseUrl, args) {
  const body = loadRequestBody(args);
  const format = args.format || 'text';

  const validation = await request(baseUrl, 'POST', '/v1/validate', body);
  if (validation.warnings && validation.warnings.length) {
    process.stderr.write(`warning: ${validation.warnings.join('; ')}\n`);
  }

  const job = await request(baseUrl, 'POST', '/v1/simulations', body);
  process.stderr.write(`[solarglyph] submitted job ${job.id} (preset: ${job.presetId || 'custom'})\n`);

  const started = Date.now();
  let state = job;
  let lastStage = '';
  while (state.status === 'running') {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      const error = new Error(`timed out after ${POLL_TIMEOUT_MS} ms waiting for job ${job.id}`);
      error.exitCode = 1;
      throw error;
    }
    await sleep(POLL_INTERVAL_MS);
    state = await request(baseUrl, 'GET', `/v1/simulations/${job.id}`);
    if (state.stage !== lastStage) {
      lastStage = state.stage;
      process.stderr.write(`[solarglyph] ${state.stage} ${(state.progress * 100).toFixed(0)}%\n`);
    }
  }

  if (state.status !== 'succeeded') {
    const error = new Error(`job ${job.id} ${state.status}: ${JSON.stringify(state.error)}`);
    error.exitCode = 1;
    throw error;
  }

  const payload = await request(baseUrl, 'GET', `/v1/simulations/${job.id}/result`);

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (format === 'markdown' || format === 'md') {
    process.stdout.write(`${formatMarkdown(payload)}\n`);
  } else if (format === 'summary') {
    const s = payload.result.summary;
    process.stdout.write(
      [
        `job=${payload.id}`,
        `preset=${payload.presetId || 'custom'}`,
        `durationMs=${payload.durationMs}`,
        `pvCapacityKwp=${s.pvCapacityKwp}`,
        `annualGenerationKwh=${s.annualGenerationKwh.toFixed(1)}`,
        `specificYieldKwhPerKwp=${s.specificYieldKwhPerKwp.toFixed(1)}`,
        `annualRecoveredHeatKwh=${s.annualRecoveredHeatKwh.toFixed(1)}`,
        `annualOrcElectricityKwh=${s.annualOrcElectricityKwh.toFixed(1)}`,
        `co2AvoidedTonnes=${s.co2AvoidedTonnes.toFixed(1)}`,
      ].join('\n') + '\n',
    );
  } else {
    process.stdout.write(`${formatText(payload)}\n`);
  }

  if (typeof args.report === 'string') {
    const out = path.resolve(args.report);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, formatMarkdown(payload), 'utf8');
    process.stderr.write(`[solarglyph] report written to ${out}\n`);
  }

  return payload;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
  const args = parseArgs(argv[0] && !argv[0].startsWith('--') ? argv.slice(1) : argv);
  const baseUrl = (args.url || DEFAULT_BASE_URL).replace(/\/+$/, '');

  switch (command) {
    case 'run': {
      await runSimulation(baseUrl, args);
      return 0;
    }
    case 'submit': {
      const body = loadRequestBody(args);
      const job = await request(baseUrl, 'POST', '/v1/simulations', body);
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return 0;
    }
    case 'status': {
      const id = args._[0] || args.id;
      if (!id) throw Object.assign(new Error('usage: status <job-id>'), { exitCode: 2 });
      process.stdout.write(`${JSON.stringify(await request(baseUrl, 'GET', `/v1/simulations/${id}`), null, 2)}\n`);
      return 0;
    }
    case 'result': {
      const id = args._[0] || args.id;
      if (!id) throw Object.assign(new Error('usage: result <job-id>'), { exitCode: 2 });
      const payload = await request(baseUrl, 'GET', `/v1/simulations/${id}/result`);
      const format = args.format || 'text';
      if (format === 'json') process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      else if (format === 'markdown' || format === 'md') process.stdout.write(`${formatMarkdown(payload)}\n`);
      else process.stdout.write(`${formatText(payload)}\n`);
      if (typeof args.report === 'string') {
        const out = path.resolve(args.report);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, formatMarkdown(payload), 'utf8');
        process.stderr.write(`[solarglyph] report written to ${out}\n`);
      }
      return 0;
    }
    case 'presets': {
      const payload = await request(baseUrl, 'GET', '/v1/models');
      if ((args.format || 'text') === 'json') {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        for (const p of payload.presets) process.stdout.write(`${p.id}\n    ${p.label}\n    ${p.description}\n\n`);
      }
      return 0;
    }
    case 'health': {
      process.stdout.write(`${JSON.stringify(await request(baseUrl, 'GET', '/v1/health'), null, 2)}\n`);
      return 0;
    }
    default: {
      process.stderr.write(
        `unknown command "${command}"\n\ncommands: run | submit | status | result | presets | health\n`,
      );
      return 2;
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    if (err.payload && err.payload.knownPresets) {
      process.stderr.write(`known presets: ${err.payload.knownPresets.join(', ')}\n`);
    }
    process.exit(err.exitCode || 1);
  });
