// Engine smoke test — runs every preset and prints the headline deliverables.
// CommonJS on purpose: the engine ships as CJS so the service needs no build step.
const { runSimulation } = require('./solarglyph-core/engine.js');
const { PRESETS, applyPreset } = require('./solarglyph-core/presets.js');

console.log('presets:', PRESETS.map((p) => p.id).join(', '));

for (const p of PRESETS) {
  const body = applyPreset({ preset: p.id }).request;
  const r = runSimulation(body);
  const s = r.summary;
  console.log(`\n[${p.id}]`);
  console.log('  cap          :', s.pvCapacityKwp, 'kWp');
  console.log('  annual POA   :', s.annualPoaKwhM2.toFixed(1), 'kWh/m2');
  console.log('  generation   :', (s.annualGenerationKwh / 10000).toFixed(1), '万kWh (', s.annualGenerationMwh.toFixed(0), 'MWh )');
  console.log('  specific     :', s.specificYieldKwhPerKwp.toFixed(1), 'kWh/kWp');
  console.log('  recovered ht :', (s.annualRecoveredHeatKwh / 10000).toFixed(1), '万kWh /', s.annualRecoveredHeatGj.toFixed(0), 'GJ');
  console.log('  ORC elec     :', (s.annualOrcElectricityKwh / 10000).toFixed(1), '万kWh');
  console.log('  CO2 avoided  :', s.co2AvoidedTonnes.toFixed(1), 't/yr');
  if (s.coolingCoverageRate !== null) console.log('  cooling cover:', (s.coolingCoverageRate * 100).toFixed(1), '%');
  console.log(
    '  peak-day AC  :',
    r.representativeDay.dailyAcKwh.toFixed(0),
    'kWh, peak',
    r.representativeDay.peakAcKw.toFixed(0),
    'kW, hours:',
    r.representativeDay.series.length,
  );
  console.log('  storage loss :', r.thermalStorage.loss24hRatePct.toFixed(2), '%/24h');
}
