// End-to-end HTTP exercise of the SolarGlyph service: submit -> poll -> result.
// Run with the service listening on SOLARGLYPH_URL (default http://127.0.0.1:8787).
const BASE = process.env.SOLARGLYPH_URL || 'http://127.0.0.1:8787';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await (await fetch(`${BASE}/v1/health`)).json();
  console.log('health:', health.status, '| service:', health.service, '| version:', health.version);
  console.log('modules:', health.model.modules.join(', '));

  console.log('\n--- submit ---');
  const submitRes = await fetch(`${BASE}/v1/simulations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: 'industrial-rooftop-5mw', label: 'E2E-verify' }),
  });
  console.log('HTTP', submitRes.status, '| Location:', submitRes.headers.get('location'));
  const job = await submitRes.json();
  console.log('job id        :', job.id);
  console.log('status/stage  :', job.status, '/', job.stage, '| progress:', job.progress);

  console.log('\n--- poll ---');
  let polled = 0;
  let state = job;
  while (state.status === 'running' && polled < 60) {
    await sleep(400);
    polled += 1;
    state = await (await fetch(`${BASE}/v1/simulations/${job.id}`)).json();
    console.log(`  t+${(polled * 0.4).toFixed(1)}s  ${state.status.padEnd(9)} ${state.stage.padEnd(28)} ${(state.progress * 100).toFixed(0)}%`);
  }

  if (state.status !== 'succeeded') {
    console.error('FAILED:', JSON.stringify(state, null, 2));
    process.exit(1);
  }

  console.log('\n--- result ---');
  const payload = await (await fetch(`${BASE}/v1/simulations/${job.id}/result`)).json();
  const s = payload.result.summary;
  console.log('duration          :', payload.durationMs, 'ms');
  console.log('PV capacity       :', s.pvCapacityKwp, 'kWp');
  console.log('annual generation :', (s.annualGenerationKwh / 10000).toFixed(1), '万kWh');
  console.log('specific yield    :', s.specificYieldKwhPerKwp.toFixed(1), 'kWh/kWp');
  console.log('recovered heat    :', (s.annualRecoveredHeatKwh / 10000).toFixed(1), '万kWh');
  console.log('ORC electricity   :', (s.annualOrcElectricityKwh / 10000).toFixed(1), '万kWh');
  console.log('CO2 avoided       :', s.co2AvoidedTonnes.toFixed(1), 't/yr');
  console.log('combined useful   :', (s.combinedUsefulEnergyKwh / 10000).toFixed(1), '万kWh');

  console.log('\n--- error handling ---');
  const bad = await fetch(`${BASE}/v1/simulations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ array: { capacityKwp: -5 } }),
  });
  console.log('invalid capacity -> HTTP', bad.status, JSON.stringify((await bad.json()).errors));
  const missing = await fetch(`${BASE}/v1/simulations/00000000-0000-4000-8000-000000000000`);
  console.log('unknown job      -> HTTP', missing.status);

  console.log('\nVERDICT: end-to-end HTTP lifecycle OK');
}

main().catch((err) => {
  console.error('E2E ERROR:', err.message);
  process.exit(1);
});
