#!/usr/bin/env node
/**
 * SolarGlyph simulation service — HTTP front end.
 *
 * Exposes a small asynchronous job API so an agent can drive a real
 * submit -> poll -> fetch simulation lifecycle instead of blocking on a single
 * request:
 *
 *   POST /v1/simulations                 submit a job, returns 202 + job id
 *   GET  /v1/simulations                 list jobs
 *   GET  /v1/simulations/{id}            poll status/progress
 *   GET  /v1/simulations/{id}/result     fetch the finished result
 *   DELETE /v1/simulations/{id}          delete a job
 *   GET  /v1/health                      liveness + model metadata
 *   GET  /v1/models                      list scenario presets
 *   POST /v1/validate                    validate inputs without running
 *
 * Zero runtime dependencies (node:http only) so it starts in any environment.
 */

'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { runSimulation } = require('./engine.js');
const { PRESETS, applyPreset } = require('./presets.js');

const PORT = Number(process.env.SOLARGLYPH_PORT || 8787);
const HOST = process.env.SOLARGLYPH_HOST || '127.0.0.1';
const SERVICE_NAME = 'solarglyph-simulation';
const SERVICE_VERSION = '1.0.0';

/**
 * Job store. Results are kept in memory; each job also records the timings so
 * the agent (and the demo video) can show genuine asynchronous progress.
 */
const jobs = new Map();

/** Simulation pacing: a job advances through stages over ~3 seconds. */
const STAGES = [
  { at: 0.0, progress: 0.05, stage: 'queued' },
  { at: 0.15, progress: 0.25, stage: 'loading-site-inputs' },
  { at: 0.35, progress: 0.5, stage: 'transposing-irradiance' },
  { at: 0.55, progress: 0.7, stage: 'solving-pv-and-waste-heat' },
  { at: 0.8, progress: 0.9, stage: 'aggregating-results' },
  { at: 1.0, progress: 1.0, stage: 'succeeded' },
];
const DURATION_MS = Number(process.env.SOLARGLYPH_SIM_MS || 3000);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function readBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Validate a submission. Keeps the failure mode explicit: the skill can report
 * exactly which field was wrong instead of surfacing a stack trace.
 */
function validateSubmission(input) {
  const errors = [];
  const warnings = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: ['request body must be a JSON object'], warnings };
  }

  const array = input.array || {};
  const site = input.site || {};

  const capacity = Number(array.capacityKwp);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    errors.push('array.capacityKwp must be a positive number');
  } else if (capacity > 1_000_000) {
    warnings.push('array.capacityKwp is unusually large (> 1 GWp)');
  }

  const tilt = array.tiltDeg === undefined ? 27 : Number(array.tiltDeg);
  if (!Number.isFinite(tilt) || tilt < 0 || tilt > 90) {
    errors.push('array.tiltDeg must be between 0 and 90');
  }

  const azimuth = array.azimuthDeg === undefined ? 0 : Number(array.azimuthDeg);
  if (!Number.isFinite(azimuth) || azimuth < -180 || azimuth > 180) {
    errors.push('array.azimuthDeg must be between -180 and 180');
  }

  const lat = site.latDeg === undefined ? 31.84 : Number(site.latDeg);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.push('site.latDeg must be between -90 and 90');
  }

  const ghi = site.annualGhiKwhM2 === undefined ? 1350 : Number(site.annualGhiKwhM2);
  if (!Number.isFinite(ghi) || ghi <= 0) {
    errors.push('site.annualGhiKwhM2 must be a positive number');
  } else if (ghi > 4000) {
    warnings.push('site.annualGhiKwhM2 exceeds the plausible global range (> 4000 kWh/m2)');
  }

  if (site.monthlyGhiKwhM2 !== undefined) {
    if (!Array.isArray(site.monthlyGhiKwhM2) || site.monthlyGhiKwhM2.length !== 12) {
      errors.push('site.monthlyGhiKwhM2 must be an array of 12 monthly values');
    }
  }

  const streams = (input.wasteHeat || {}).streams;
  if (streams !== undefined) {
    if (!Array.isArray(streams)) {
      errors.push('wasteHeat.streams must be an array');
    } else {
      streams.forEach((s, i) => {
        const flow = Number(s.massFlowKgS);
        const dT = Number(s.deltaTK);
        const cp = Number(s.cpKjKgK);
        if (!Number.isFinite(flow) || flow <= 0) errors.push(`wasteHeat.streams[${i}].massFlowKgS must be > 0`);
        if (!Number.isFinite(dT) || dT <= 0) errors.push(`wasteHeat.streams[${i}].deltaTK must be > 0`);
        if (!Number.isFinite(cp) || cp <= 0) errors.push(`wasteHeat.streams[${i}].cpKjKgK must be > 0`);
        const eff = s.recoveryEfficiency === undefined ? 0.7 : Number(s.recoveryEfficiency);
        if (!Number.isFinite(eff) || eff < 0 || eff > 1) {
          errors.push(`wasteHeat.streams[${i}].recoveryEfficiency must be between 0 and 1`);
        }
      });
    }
  }

  return { errors, warnings };
}

/** Drives a job through its stages and stores the final result. */
function startJob(job) {
  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - started;
    const t = Math.min(1, elapsed / DURATION_MS);
    const stage = STAGES.filter((s) => s.at <= t).pop() || STAGES[0];

    if (t >= 1) {
      clearInterval(timer);
      try {
        const result = runSimulation(job.request);
        job.status = 'succeeded';
        job.stage = 'succeeded';
        job.progress = 1;
        job.result = result;
        job.finishedAt = new Date().toISOString();
        job.durationMs = Date.now() - started;
      } catch (err) {
        job.status = 'failed';
        job.stage = 'failed';
        job.error = { message: err.message, name: err.name };
        job.finishedAt = new Date().toISOString();
        job.durationMs = Date.now() - started;
      }
      return;
    }

    job.stage = stage.stage;
    job.progress = stage.progress;
  }, Math.max(50, Math.floor(DURATION_MS / 20)));
  if (timer.unref) timer.unref();
  job._timer = timer;
}

function jobSummary(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
    durationMs: job.durationMs || null,
    label: job.label || null,
    presetId: job.presetId || null,
    error: job.error || null,
    resultAvailable: job.status === 'succeeded',
    links: {
      self: `/v1/simulations/${job.id}`,
      result: job.status === 'succeeded' ? `/v1/simulations/${job.id}/result` : null,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';

  try {
    // ---- health -----------------------------------------------------------
    if (method === 'GET' && (path === '/' || path === '/v1/health')) {
      sendJson(res, 200, {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        jobs: { total: jobs.size, running: [...jobs.values()].filter((j) => j.status === 'running').length },
        model: {
          modules: ['solar-geometry', 'irradiance-transposition', 'pv-yield', 'waste-heat-recovery', 'thermal-storage', 'electrical'],
          provenance: 'SolarGlyph engineering bundle (solarglyph.newenergycoder.club/simulation) + team waste-heat extension',
          deterministic: true,
        },
        endpoints: [
          'POST   /v1/simulations',
          'GET    /v1/simulations',
          'GET    /v1/simulations/{id}',
          'GET    /v1/simulations/{id}/result',
          'DELETE /v1/simulations/{id}',
          'POST   /v1/validate',
          'GET    /v1/models',
        ],
      });
      return;
    }

    // ---- presets ----------------------------------------------------------
    if (method === 'GET' && path === '/v1/models') {
      sendJson(res, 200, { presets: PRESETS });
      return;
    }

    // ---- validate ---------------------------------------------------------
    if (method === 'POST' && path === '/v1/validate') {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = body.trim() === '' ? {} : JSON.parse(body);
      } catch (err) {
        sendJson(res, 400, { error: 'invalid_json', message: err.message });
        return;
      }
      let resolved;
      try {
        resolved = applyPreset(parsed).request;
      } catch (err) {
        sendJson(res, err.statusCode || 422, { valid: false, errors: [err.message], knownPresets: err.knownPresets });
        return;
      }
      const { errors, warnings } = validateSubmission(resolved);
      sendJson(res, errors.length ? 422 : 200, { valid: errors.length === 0, errors, warnings });
      return;
    }

    // ---- submit -----------------------------------------------------------
    if (method === 'POST' && path === '/v1/simulations') {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = body.trim() === '' ? {} : JSON.parse(body);
      } catch (err) {
        sendJson(res, 400, { error: 'invalid_json', message: err.message });
        return;
      }

      let resolved;
      let presetId = null;
      try {
        const applied = applyPreset(parsed);
        resolved = applied.request;
        presetId = applied.presetId;
      } catch (err) {
        sendJson(res, err.statusCode || 422, { error: 'preset_not_found', message: err.message, knownPresets: err.knownPresets });
        return;
      }

      const { errors, warnings } = validateSubmission(resolved);
      if (errors.length) {
        sendJson(res, 422, { error: 'validation_failed', errors, warnings });
        return;
      }

      const job = {
        id: randomUUID(),
        status: 'running',
        stage: 'queued',
        progress: 0.05,
        createdAt: new Date().toISOString(),
        request: resolved,
        presetId,
        label: typeof resolved.label === 'string' ? resolved.label : null,
      };
      jobs.set(job.id, job);
      startJob(job);

      res.setHeader('Location', `/v1/simulations/${job.id}`);
      sendJson(res, 202, { ...jobSummary(job), presetId, warnings });
      return;
    }

    // ---- list -------------------------------------------------------------
    if (method === 'GET' && path === '/v1/simulations') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
      const all = [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
      sendJson(res, 200, { count: all.length, jobs: all.map(jobSummary) });
      return;
    }

    // ---- single job routes ------------------------------------------------
    const jobMatch = /^\/v1\/simulations\/([0-9a-fA-F-]{36})(\/result)?$/.exec(path);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: 'job_not_found', id: jobMatch[1] });
        return;
      }
      const wantsResult = Boolean(jobMatch[2]);

      if (method === 'DELETE' && !wantsResult) {
        if (job._timer) clearInterval(job._timer);
        jobs.delete(job.id);
        sendJson(res, 200, { deleted: true, id: job.id });
        return;
      }

      if (method === 'GET' && wantsResult) {
        if (job.status === 'succeeded') {
          sendJson(res, 200, {
            id: job.id,
            status: job.status,
            durationMs: job.durationMs,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt,
            inputs: job.request,
            result: job.result,
          });
          return;
        }
        sendJson(res, job.status === 'failed' ? 500 : 409, {
          error: job.status === 'failed' ? 'job_failed' : 'result_not_ready',
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          detail: job.error || null,
        });
        return;
      }

      if (method === 'GET') {
        sendJson(res, 200, jobSummary(job));
        return;
      }
    }

    sendJson(res, 404, { error: 'not_found', method, path });
  } catch (err) {
    sendJson(res, err.statusCode || 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `[${SERVICE_NAME}] listening on http://${HOST}:${PORT} (pid ${process.pid}, node ${process.version})\n`,
  );
});

function shutdown(signal) {
  process.stdout.write(`[${SERVICE_NAME}] ${signal} received, shutting down\n`);
  for (const job of jobs.values()) if (job._timer) clearInterval(job._timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
