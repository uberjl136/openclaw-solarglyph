/**
 * SolarGlyph engineering model — photovoltaic generation + waste-heat recovery.
 *
 * PROVENANCE
 * ----------
 * The irradiance / solar-geometry / array-yield equations in this module were
 * re-derived from the SolarGlyph simulation front-end engineering bundle
 * (https://solarglyph.newenergycoder.club/simulation, asset index-BQN0yBzB.js).
 * Each formula records the source construct it was reverse-engineered from, so
 * the mapping back to the originating project is auditable. See
 * docs/solarglyph-algorithm-provenance.md for the full formula-level trace.
 *
 * Waste-heat recovery (air-cooled condenser hot-air recycling, jacket-water
 * recovery and boiler flue-gas recovery) is a team-authored extension: the
 * upstream SolarGlyph bundle models PV + thermal storage + district cooling but
 * does not model exhaust-heat recovery, which is what this skill adds.
 *
 * The module is dependency-free and deterministic: identical inputs produce
 * byte-identical outputs, which is what makes the skill's results verifiable.
 */

'use strict';

// ---------------------------------------------------------------------------
// Unit helpers + input coercion (mirrors upstream clamp/non-negative helpers)
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** Upstream `Dt` / `Ya`: degree <-> radian conversion. */
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
/** Upstream `Qe`: clamp a value into [min, max]. */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
/** Upstream `Ea`: clamp into [0,1], non-finite -> 0 (fraction inputs). */
const frac = (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);
/** Upstream `Vn`: clamp to >= 0, non-finite -> 0 (physical magnitudes). */
const nonNeg = (v) => (Number.isFinite(v) ? Math.max(0, v) : 0);
/** Coerce arbitrary input to a finite number, falling back to a default. */
const num = (v, dflt = 0) => {
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// ---------------------------------------------------------------------------
// 1. Solar geometry
// ---------------------------------------------------------------------------

/**
 * Declination angle (Cooper's equation), degrees.
 * Upstream `bo(dayOfYear) = 23.45*sin(Dt(360*(284+n)/365))`.
 */
function declinationDeg(dayOfYear) {
  return 23.45 * Math.sin(toRad((360 * (284 + dayOfYear)) / 365));
}

/** Day of year, 1..365. Upstream `yo`. */
function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Hour angle in degrees (solar time, 15 deg per hour from solar noon). */
function hourAngleDeg(hour) {
  return (hour - 12) * 15;
}

/**
 * Solar altitude angle (degrees).
 * Upstream `Zm`: sin(alt) = sin(lat)sin(dec) + cos(lat)cos(dec)cos(hourAngle).
 */
function solarAltitudeDeg({ latDeg, date, hour }) {
  const lat = toRad(latDeg);
  const dec = toRad(declinationDeg(dayOfYear(date)));
  const ha = toRad(hourAngleDeg(hour));
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return toDeg(Math.asin(clamp(sinAlt, -1, 1)));
}

/**
 * Incidence angle factors for a tilted surface.
 * Upstream `Qm` returns { cosTheta, cosZenith } using the standard tilted-plane
 * identity; cosTheta is clamped into [-1, 1] exactly as upstream does.
 */
function incidenceFactors({ latDeg, tiltDeg, azimuthDeg, date, hour }) {
  const lat = toRad(latDeg);
  const dec = toRad(declinationDeg(dayOfYear(date)));
  const ha = toRad(hourAngleDeg(hour));
  const tilt = toRad(tiltDeg);
  const azi = toRad(azimuthDeg);

  const cosTheta =
    Math.sin(dec) * Math.sin(lat) * Math.cos(tilt) -
    Math.sin(dec) * Math.cos(lat) * Math.sin(tilt) * Math.cos(azi) +
    Math.cos(dec) * Math.cos(lat) * Math.cos(tilt) * Math.cos(ha) +
    Math.cos(dec) * Math.sin(lat) * Math.sin(tilt) * Math.cos(azi) * Math.cos(ha) +
    Math.cos(dec) * Math.sin(tilt) * Math.sin(azi) * Math.sin(ha);

  const cosZenith = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);

  return { cosTheta: clamp(cosTheta, -1, 1), cosZenith: clamp(cosZenith, -1, 1) };
}

/**
 * Monthly transposition index.
 * Upstream `Cn({latDeg,tiltDeg,azimuthDeg})`: samples representative days
 * (15th of each month at 09:00/12:00/15:00 solar time), accumulates
 * max(0,cosTheta) / max(0,cosZenith) and averages. The returned per-month
 * factors multiply horizontal irradiance to obtain plane-of-array irradiance.
 */
const REPRESENTATIVE_DAYS = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const SAMPLE_HOURS = [9, 12, 15];

function transpositionIndex({ latDeg, tiltDeg, azimuthDeg }) {
  const monthly = [];
  for (const day of REPRESENTATIVE_DAYS) {
    const date = new Date(Date.UTC(2025, 0, day));
    let sumTilted = 0;
    let sumHorizontal = 0;
    for (const hour of SAMPLE_HOURS) {
      const { cosTheta, cosZenith } = incidenceFactors({ latDeg, tiltDeg, azimuthDeg, date, hour });
      sumTilted += Math.max(0, cosTheta);
      sumHorizontal += Math.max(0, cosZenith);
    }
    monthly.push(sumHorizontal <= 1e-9 ? 0 : sumTilted / sumHorizontal);
  }
  const annual = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  return { monthly, annual };
}

/** Seasonal GHI shape used upstream when a site has no monthly series. */
const DEFAULT_MONTHLY_SHAPE = [0.05, 0.05, 0.08, 0.09, 0.1, 0.11, 0.12, 0.11, 0.09, 0.08, 0.06, 0.06];

/**
 * Monthly and annual plane-of-array irradiance (kWh/m^2).
 * Upstream `lh` (tilt/azimuth explorer): distribute annual GHI across months
 * with the seasonal shape when no monthly GHI series is supplied, then multiply
 * each month by the transposition index.
 */
function irradianceProfile({ latDeg, tiltDeg, azimuthDeg, annualGhiKwhM2, monthlyGhiKwhM2 }) {
  const geom = transpositionIndex({ latDeg, tiltDeg, azimuthDeg });
  const shapeSum = DEFAULT_MONTHLY_SHAPE.reduce((a, b) => a + b, 0) || 1;

  const monthlyGhi =
    Array.isArray(monthlyGhiKwhM2) && monthlyGhiKwhM2.length === 12
      ? monthlyGhiKwhM2.map((v) => nonNeg(num(v)))
      : DEFAULT_MONTHLY_SHAPE.map((s) => (nonNeg(annualGhiKwhM2) * s) / shapeSum);

  const monthlyPoa = monthlyGhi.map((ghi, i) => ghi * geom.monthly[i]);
  const annualGhi = monthlyGhi.reduce((a, b) => a + b, 0);
  const annualPoa = monthlyPoa.reduce((a, b) => a + b, 0);

  return {
    transpositionMonthly: geom.monthly,
    transpositionAnnual: geom.annual,
    monthlyGhiKwhM2: monthlyGhi,
    monthlyPoaKwhM2: monthlyPoa,
    annualGhiKwhM2: annualGhi,
    annualPoaKwhM2: annualPoa,
    poaGainPct: annualGhi > 0 ? (annualPoa / annualGhi - 1) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// 2. Photovoltaic array model
// ---------------------------------------------------------------------------

/**
 * Performance ratio corrected for cell temperature.
 *
 * Upstream supplies a specific yield (kWh/kWp/yr) plus an explicit tilt/azimuth
 * transposition model rather than a cell-temperature model, so this function
 * applies the standard NOCT/NOCT-style derate on top of the upstream yield:
 *   P_dc = P_stc * (G_poa/1000) * (1 + gamma*(T_cell - 25))
 *   T_cell = T_amb + (NOCT - 20) * G_poa / 800
 * `gamma` is negative for crystalline silicon, so hotter cells yield less.
 */
function cellTemperatureC({ ambientC, poaWm2, noctC = 45 }) {
  return ambientC + ((noctC - 20) * poaWm2) / 800;
}

function temperatureDerate({ ambientC, poaWm2, noctC, gammaPerC }) {
  const tCell = cellTemperatureC({ ambientC, poaWm2, noctC });
  return { cellTemperatureC: tCell, derate: clamp(1 + gammaPerC * (tCell - 25), 0, 1.2) };
}

/**
 * Annual PV yield.
 *
 * Two paths, both anchored on real upstream behaviour:
 *  - `specificYieldKwhPerKwp` given (upstream default 1250, and the ROI panel
 *    uses 1200): yield = capacity * specificYield. This is the upstream model.
 *  - otherwise yield is derived from plane-of-array irradiance via the
 *    performance-ratio chain, with a temperature derate from an effective
 *    irradiance/ambient pair.
 *
 * `systemLossFactor` absorbs soiling, mismatch, wiring, and inverter losses
 * (upstream exposes dc/ac ratio and wiring voltage-drop helpers separately).
 */
function pvYield({
  capacityKwp,
  specificYieldKwhPerKwp,
  annualPoaKwhM2,
  performanceRatio,
  ambientC,
  effectivePoaWm2,
  noctC,
  gammaPerC,
  systemLossFactor,
}) {
  const cap = nonNeg(num(capacityKwp));

  if (Number.isFinite(num(specificYieldKwhPerKwp, NaN))) {
    const sy = nonNeg(num(specificYieldKwhPerKwp));
    return {
      method: 'specific-yield',
      specificYieldKwhPerKwp: sy,
      annualGenerationKwh: cap * sy,
      performanceRatio: null,
      cellTemperatureC: null,
      temperatureDerate: null,
    };
  }

  const pr = frac(num(performanceRatio, 0.82));
  const loss = frac(num(systemLossFactor, 0.14));
  const derate = temperatureDerate({
    ambientC: num(ambientC, 20),
    poaWm2: nonNeg(num(effectivePoaWm2, 700)),
    noctC: num(noctC, 45),
    gammaPerC: num(gammaPerC, -0.0035),
  });
  const poa = nonNeg(num(annualPoaKwhM2));
  const specific = poa * pr * derate.derate * (1 - loss);

  return {
    method: 'irradiance-performance-ratio',
    specificYieldKwhPerKwp: specific,
    annualGenerationKwh: cap * specific,
    performanceRatio: pr,
    cellTemperatureC: derate.cellTemperatureC,
    temperatureDerate: derate.derate,
  };
}

// ---------------------------------------------------------------------------
// 3. Waste-heat recovery (team-authored extension)
// ---------------------------------------------------------------------------

/** Sensible heat carried by a fluid stream: Q = m_dot * cp * dT (kW). */
function sensibleHeatKw({ massFlowKgS, cpKjKgK, deltaTK }) {
  return nonNeg(num(massFlowKgS)) * nonNeg(num(cpKjKgK)) * nonNeg(num(deltaTK));
}

/**
 * Recoverable heat from a stream, limited by both the stream's available
 * enthalpy and the heat-exchanger/pinch capacity, then scaled by recovery
 * efficiency and availability (uptime fraction).
 */
function streamRecovery({ name, massFlowKgS, cpKjKgK, deltaTK, recoveryEfficiency, availability, pinchLimitKw }) {
  const availableKw = sensibleHeatKw({ massFlowKgS, cpKjKgK, deltaTK });
  const eff = frac(num(recoveryEfficiency, 0.7));
  const avail = frac(num(availability, 1));
  const pinch = nonNeg(num(pinchLimitKw, Infinity));
  const recoveredKw = Math.min(availableKw, pinch) * eff * avail;
  return {
    name,
    availableThermalKw: availableKw,
    recoveryEfficiency: eff,
    availability: avail,
    recoveredThermalKw: recoveredKw,
    hoursPerYear: 8760 * avail,
    annualRecoveredHeatKwh: recoveredKw * 8760 * avail,
  };
}

/**
 * Full waste-heat recovery block plus the two conversions that make it useful:
 *  - electricity via an organic Rankine cycle (ORC) at `orcEfficiency`
 *  - hot water / process heat at `heatUtilisationEfficiency`
 * A CO2 figure uses the grid emission factor so the result is reportable.
 */
function wasteHeatRecovery({
  streams = [],
  orcEfficiency = 0.12,
  heatUtilisationEfficiency = 0.85,
  gridEmissionFactorKgPerKwh = 0.581,
}) {
  const detail = streams.map((s) => streamRecovery(s));
  const totalAvailableKw = detail.reduce((a, s) => a + s.availableThermalKw, 0);
  const totalRecoveredKw = detail.reduce((a, s) => a + s.recoveredThermalKw, 0);
  const annualRecoveredKwh = detail.reduce((a, s) => a + s.annualRecoveredHeatKwh, 0);

  const orc = frac(num(orcEfficiency, 0.12));
  const heatUse = frac(num(heatUtilisationEfficiency, 0.85));
  const annualOrcElectricityKwh = annualRecoveredKwh * orc;
  const annualUsableHeatKwh = annualRecoveredKwh * heatUse;

  return {
    streams: detail,
    totalAvailableThermalKw: totalAvailableKw,
    totalRecoveredThermalKw: totalRecoveredKw,
    annualRecoveredHeatKwh: annualRecoveredKwh,
    orcEfficiency: orc,
    annualOrcElectricityKwh,
    heatUtilisationEfficiency: heatUse,
    annualUsableHeatKwh,
    co2AvoidedTonnes:
      ((annualOrcElectricityKwh + annualUsableHeatKwh) * nonNeg(num(gridEmissionFactorKgPerKwh, 0.581))) / 1000,
  };
}

// ---------------------------------------------------------------------------
// 4. Thermal storage (mirrors the upstream storage calculator)
// ---------------------------------------------------------------------------

const STORAGE_MEDIA = {
  water: { label: '水', densityKgM3: 983.2, cpKjKgK: 4.183 },
  glycol30: { label: '乙二醇溶液 30%', densityKgM3: 1041.0, cpKjKgK: 3.66 },
  thermalOil: { label: '导热油', densityKgM3: 900.0, cpKjKgK: 2.0 },
};

/**
 * Sensible thermal store sizing and standing loss.
 * Upstream storage calculator emits exactly these equations:
 *   E = rho*V*cp*dT/3600 (kWh); H=D cylinder => D=(4V/pi)^(1/3);
 *   A = pi*D*H + pi*D^2/2; U ~= lambda/t; P_loss = U*A*dT/1000 (kW).
 */
function thermalStorage({ volumeM3, deltaTK, medium = 'water', insulationThicknessM = 0.1, insulationLambdaWmK = 0.035, dischargePowerKw = 0, chargePowerKw = 0 }) {
  const media = STORAGE_MEDIA[medium] || STORAGE_MEDIA.water;
  const volume = nonNeg(num(volumeM3));
  const dT = nonNeg(num(deltaTK));
  const thickness = Math.max(0.001, num(insulationThicknessM, 0.1));
  const lambda = nonNeg(num(insulationLambdaWmK, 0.035));

  const storedEnergyKwh = (media.densityKgM3 * volume * media.cpKjKgK * dT) / 3600;
  const diameterM = Math.cbrt((4 * volume) / Math.PI);
  const heightM = diameterM;
  const areaM2 = Math.PI * diameterM * heightM + (Math.PI * diameterM * diameterM) / 2;
  const uWm2K = lambda / thickness;
  const lossPowerKw = (uWm2K * areaM2 * dT) / 1000;
  const loss24hKwh = lossPowerKw * 24;

  const discharge = nonNeg(num(dischargePowerKw));
  const charge = nonNeg(num(chargePowerKw));
  const usableTimeH = discharge + lossPowerKw > 0 ? storedEnergyKwh / (discharge + lossPowerKw) : 0;
  const chargeTimeNetH = charge - lossPowerKw > 0 ? storedEnergyKwh / (charge - lossPowerKw) : 0;

  return {
    medium,
    mediumLabel: media.label,
    densityKgM3: media.densityKgM3,
    cpKjKgK: media.cpKjKgK,
    volumeM3: volume,
    deltaTK: dT,
    storedEnergyKwh,
    geometry: { diameterM, heightM, areaM2 },
    uWm2K,
    lossPowerKw,
    loss24hKwh,
    loss24hRatePct: storedEnergyKwh > 0 ? (loss24hKwh / storedEnergyKwh) * 100 : 0,
    usableTimeH,
    chargeTimeIdealH: charge > 0 ? storedEnergyKwh / charge : 0,
    chargeTimeNetH,
  };
}

// ---------------------------------------------------------------------------
// 5. Electrical helpers (mirrors upstream inverter / cable calculators)
// ---------------------------------------------------------------------------

/** Upstream `th`: inverter apparent power and AC current. */
function inverterCurrent({ phase = '3p', peKw, kx = 1, cosPhi = 0.9, eta = 0.98, uV = 400 }) {
  const pjsKw = Math.max(0, num(peKw)) * clamp(num(kx, 1), 0, 2);
  const denominator =
    phase === '3p'
      ? Math.sqrt(3) * num(uV) * clamp(num(cosPhi, 0.9), 0.05, 1) * clamp(num(eta, 0.98), 0.05, 1)
      : num(uV) * clamp(num(cosPhi, 0.9), 0.05, 1) * clamp(num(eta, 0.98), 0.05, 1);
  return { pjsKw, currentA: denominator > 1e-9 ? (pjsKw * 1000) / denominator : 0 };
}

/** Upstream `Jm` / `eh`: copper and aluminium resistance per km. */
const resistanceOhmPerKm = (material, sectionMm2) =>
  (material === 'cu' ? 17.5 : 28.5) / Math.max(0.5, num(sectionMm2));

/** Upstream `nh`: line voltage drop (%) including optional reactance. */
function voltageDropPct({ phase = '3p', uV = 400, material = 'cu', sectionMm2 = 120, lengthKm = 0.1, currentA = 0, cosPhi = 0.9, includeReactance = false, xOhmKm = 0.08 }) {
  const r = resistanceOhmPerKm(material, sectionMm2);
  const pf = clamp(num(cosPhi, 0.9), 0, 1);
  const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
  const x = includeReactance ? Math.max(0, num(xOhmKm)) : 0;
  const k = phase === '3p' ? Math.sqrt(3) : 2;
  const dropV = k * Math.max(0, num(currentA)) * (r * pf + x * sinPhi) * Math.max(0, num(lengthKm));
  return { rOhmPerKm: r, dropV, dropPct: num(uV) > 1e-9 ? (dropV / num(uV)) * 100 : 0 };
}

// ---------------------------------------------------------------------------
// 6. PV-to-cooling matching (mirrors the upstream "光伏蓄冷空调" engineering page)
// ---------------------------------------------------------------------------

/**
 * Annual PV-to-cooling matching.
 *
 * Reverse-engineered from the upstream `Rm` calculator, whose whole body is:
 *   d = capacity * specificYield                    (annual PV generation)
 *   g = d * pvToCoolingShare                        (electricity allocated to cooling)
 *   x = g * directUseShare * chillerCop             (cooling delivered direct)
 *   m = g * (1-directUseShare) * roundTrip * cop    (cooling shifted via storage)
 *   f = min(annualDemand, x+m)                      (cooling actually served by PV)
 *   v = max(0, demand - f)                          (grid-supplemented cooling)
 *   p = max(0, x+m - demand)                        (surplus cooling potential)
 *   coverage = demand > 0 ? f/demand : 0
 */
function pvCoolingMatching({
  pvCapacityKw,
  specificYieldKwhPerKwYear,
  pvToCoolingShare,
  directUseShare,
  chillerCop,
  storageRoundTripEfficiency,
  annualCoolingDemandKwh,
  operatingDays,
  storageDischargeHours,
}) {
  const cap = nonNeg(num(pvCapacityKw));
  const specific = nonNeg(num(specificYieldKwhPerKwYear));
  const toCooling = frac(num(pvToCoolingShare));
  const direct = frac(num(directUseShare));
  const cop = nonNeg(num(chillerCop));
  const roundTrip = frac(num(storageRoundTripEfficiency));
  const demand = nonNeg(num(annualCoolingDemandKwh));
  const days = nonNeg(num(operatingDays));
  const dischargeHours = nonNeg(num(storageDischargeHours));

  const pvAnnualGenerationKwh = cap * specific;
  const pvCoolingElectricityKwh = pvAnnualGenerationKwh * toCooling;
  const directCoolingKwh = pvCoolingElectricityKwh * direct * cop;
  const storageShiftedCoolingKwh = pvCoolingElectricityKwh * (1 - direct) * roundTrip * cop;
  const totalFromPvKwh = directCoolingKwh + storageShiftedCoolingKwh;
  const totalCoolingFromPvKwh = Math.min(demand, totalFromPvKwh);
  const gridSupplementCoolingKwh = Math.max(0, demand - totalCoolingFromPvKwh);
  const surplusCoolingPotentialKwh = Math.max(0, totalFromPvKwh - demand);
  const coolingCoverageRate = demand > 0 ? totalCoolingFromPvKwh / demand : 0;
  const recommendedStorageDischargeKw =
    days > 0 && dischargeHours > 0 ? storageShiftedCoolingKwh / days / dischargeHours : 0;

  return {
    pvAnnualGenerationKwh,
    pvCoolingElectricityKwh,
    directCoolingKwh,
    storageShiftedCoolingKwh,
    totalCoolingFromPvKwh,
    gridSupplementCoolingKwh,
    surplusCoolingPotentialKwh,
    coolingCoverageRate,
    recommendedStorageDischargeKw,
  };
}

// ---------------------------------------------------------------------------
// 7. Hourly dispatch — the "simulation" proper
// ---------------------------------------------------------------------------

/**
 * Build a 24-hour clear-sky-shaped irradiance trace for one representative day.
 *
 * The upstream bundle works from monthly GHI/POA aggregates, so a daily trace is
 * reconstructed here with the standard clear-sky sine shape normalised so the
 * integrated daily POA matches the requested daily energy. This is what lets the
 * service return an hourly power curve, which the OpenClaw skill charts.
 */
function hourlyProfile({ dayPoaKwhM2, latDeg, tiltDeg, azimuthDeg, date, ambientC, noonAmbientC }) {
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const { cosTheta, cosZenith } = incidenceFactors({ latDeg, tiltDeg, azimuthDeg, date, hour });
    hours.push({
      hour,
      cosTheta: Math.max(0, cosTheta),
      cosZenith: Math.max(0, cosZenith),
      altitudeDeg: solarAltitudeDeg({ latDeg, date, hour }),
    });
  }
  const shapeSum = hours.reduce((a, h) => a + h.cosTheta, 0);
  const ambientByHour = (hour) => {
    // Diurnal ambient swing: minimum near 05:00, maximum near 15:00.
    const phase = ((hour - 15) / 24) * 2 * Math.PI;
    const mid = (num(ambientC, 20) + num(noonAmbientC, num(ambientC, 20) + 6)) / 2;
    const amp = Math.abs(num(noonAmbientC, mid) - num(ambientC, 20)) / 2;
    return mid + amp * Math.cos(phase);
  };
  return hours.map((h) => ({
    ...h,
    poaWm2: shapeSum > 0 ? (h.cosTheta / shapeSum) * (num(dayPoaKwhM2) * 1000) : 0,
    ambientC: ambientByHour(h.hour),
  }));
}

/**
 * Simulate one day: hourly DC/AC PV output plus hourly recoverable waste heat.
 * Returns the hourly series and the daily aggregates.
 */
function simulateDay(input) {
  const {
    latDeg,
    tiltDeg,
    azimuthDeg,
    capacityKwp,
    dayPoaKwhM2,
    dateIso,
    ambientC,
    noonAmbientC,
    noctC = 45,
    gammaPerC = -0.0035,
    systemLossFactor = 0.14,
    dcAcRatio = 1.2,
    wasteHeat = {},
    storage = {},
  } = input;

  const date = new Date(dateIso || Date.UTC(2025, 5, 21));
  const trace = hourlyProfile({ dayPoaKwhM2, latDeg, tiltDeg, azimuthDeg, date, ambientC, noonAmbientC });

  const cap = nonNeg(num(capacityKwp));
  const loss = frac(num(systemLossFactor, 0.14));
  const ratio = Math.max(0.1, num(dcAcRatio, 1.2));

  const series = trace.map((h) => {
    const derate = temperatureDerate({ ambientC: h.ambientC, poaWm2: h.poaWm2, noctC, gammaPerC });
    const dcKw = (cap * (h.poaWm2 / 1000)) * derate.derate;
    const acKw = dcKw * (1 - loss);
    return {
      hour: h.hour,
      poaWm2: h.poaWm2,
      ambientC: h.ambientC,
      cellTemperatureC: derate.cellTemperatureC,
      dcPowerKw: dcKw,
      acPowerKw: acKw,
      clippedAcKw: ratio * cap > 0 ? Math.min(acKw, ratio * cap) : acKw,
    };
  });

  const dailyAcKwh = series.reduce((a, s) => a + s.acPowerKw, 0) * 1; // 1-hour steps
  const peakAcKw = series.reduce((a, s) => Math.max(a, s.acPowerKw), 0);
  const clippedKwh = series.reduce((a, s) => a + Math.max(0, s.acPowerKw - s.clippedAcKw), 0);

  const recovery = wasteHeatRecovery(wasteHeat);
  const thermal = thermalStorage(storage);
  const dailyRecoveredHeatKwh = recovery.totalRecoveredThermalKw * 24 * frac(num(wasteHeat.availability, 1));

  return {
    date: date.toISOString().slice(0, 10),
    series,
    dailyAcKwh,
    peakAcKw,
    clippedKwh,
    specificYieldKwhPerKwp: cap > 0 ? dailyAcKwh / cap : 0,
    dailyRecoveredHeatKwh,
    recovery,
    thermal,
  };
}

// ---------------------------------------------------------------------------
// 8. Annual roll-up — the headline numbers the service reports
// ---------------------------------------------------------------------------

/**
 * Full annual simulation: irradiance transposition -> PV yield -> waste-heat
 * recovery, plus optional storage and electrical checks.
 */
function runSimulation(rawInput = {}) {
  const site = rawInput.site || {};
  const array = rawInput.array || {};
  const wasteHeat = rawInput.wasteHeat || {};
  const storage = rawInput.storage || {};
  const electrical = rawInput.electrical || {};

  const latDeg = num(site.latDeg, 31.84);
  const tiltDeg = num(array.tiltDeg, 27);
  const azimuthDeg = num(array.azimuthDeg, 0);
  const annualGhiKwhM2 = nonNeg(num(site.annualGhiKwhM2, 1350));
  const capacityKwp = nonNeg(num(array.capacityKwp, 1000));

  const irradiance = irradianceProfile({
    latDeg,
    tiltDeg,
    azimuthDeg,
    annualGhiKwhM2,
    monthlyGhiKwhM2: site.monthlyGhiKwhM2,
  });

  const yieldInput = { capacityKwp, annualPoaKwhM2: irradiance.annualPoaKwhM2 };
  if (array.specificYieldKwhPerKwp !== undefined && array.specificYieldKwhPerKwp !== null) {
    yieldInput.specificYieldKwhPerKwp = num(array.specificYieldKwhPerKwp);
  } else {
    yieldInput.performanceRatio = num(array.performanceRatio, 0.82);
    yieldInput.systemLossFactor = num(array.systemLossFactor, 0.14);
    yieldInput.ambientC = num(site.annualMeanAmbientC, 20);
    yieldInput.effectivePoaWm2 = num(site.effectivePoaWm2, 700);
    yieldInput.noctC = num(array.noctC, 45);
    yieldInput.gammaPerC = num(array.gammaPerC, -0.0035);
  }
  const pv = pvYield(yieldInput);

  const recovery = wasteHeatRecovery(wasteHeat);
  const thermal = thermalStorage({ volumeM3: storage.volumeM3, deltaTK: storage.deltaTK, ...storage });

  const electricalOut = electrical.peKw
    ? (() => {
        const inv = inverterCurrent(electrical);
        const drop = voltageDropPct({ ...electrical, currentA: inv.currentA });
        return { ...inv, ...drop };
      })()
    : null;

  // Representative day for the hourly curve: use the peak-irradiance month.
  const peakMonth = irradiance.monthlyPoaKwhM2.reduce(
    (best, v, i, arr) => (v > arr[best] ? i : best),
    0,
  );
  const dayPoa = irradiance.monthlyPoaKwhM2[peakMonth] / 30.4;
  const day = simulateDay({
    latDeg,
    tiltDeg,
    azimuthDeg,
    capacityKwp,
    dayPoaKwhM2: dayPoa,
    dateIso: `2025-${String(peakMonth + 1).padStart(2, '0')}-21`,
    ambientC: num(site.annualMeanAmbientC, 20),
    noonAmbientC: num(site.noonAmbientC, num(site.annualMeanAmbientC, 20) + 6),
    noctC: num(array.noctC, 45),
    gammaPerC: num(array.gammaPerC, -0.0035),
    systemLossFactor: num(array.systemLossFactor, 0.14),
    dcAcRatio: num(array.dcAcRatio, 1.2),
    wasteHeat,
    storage,
  });

  const totalGenerationKwh = pv.annualGenerationKwh;
  const totalRecoveredHeatKwh = recovery.annualRecoveredHeatKwh;

  const coolingOut = rawInput.cooling
    ? pvCoolingMatching({
        pvCapacityKw: capacityKwp,
        specificYieldKwhPerKwYear:
          pv.specificYieldKwhPerKwp || num(array.specificYieldKwhPerKwp, 1250),
        ...rawInput.cooling,
      })
    : null;

  return {
    inputs: { site, array, wasteHeat, storage, electrical },
    pv: {
      ...pv,
      capacityKwp,
      irradiance,
    },
    wasteHeat: recovery,
    thermalStorage: thermal,
    electrical: electricalOut,
    cooling: coolingOut,
    representativeDay: {
      month: peakMonth + 1,
      date: day.date,
      dayPoaKwhM2: dayPoa,
      dailyAcKwh: day.dailyAcKwh,
      peakAcKw: day.peakAcKw,
      clippedKwh: day.clippedKwh,
      specificYieldKwhPerKwp: day.specificYieldKwhPerKwp,
      dailyRecoveredHeatKwh: day.dailyRecoveredHeatKwh,
      series: day.series,
    },
    summary: {
      pvCapacityKwp: capacityKwp,
      annualPoaKwhM2: irradiance.annualPoaKwhM2,
      annualGenerationKwh: totalGenerationKwh,
      annualGenerationMwh: totalGenerationKwh / 1000,
      specificYieldKwhPerKwp: pv.specificYieldKwhPerKwp,
      annualRecoveredHeatKwh: totalRecoveredHeatKwh,
      annualRecoveredHeatGj: totalRecoveredHeatKwh * 0.0036,
      annualOrcElectricityKwh: recovery.annualOrcElectricityKwh,
      combinedUsefulEnergyKwh: totalGenerationKwh + recovery.annualOrcElectricityKwh + recovery.annualUsableHeatKwh,
      co2AvoidedTonnes: recovery.co2AvoidedTonnes,
      temperatureDerate: pv.temperatureDerate,
      cellTemperatureC: pv.cellTemperatureC,
      coolingCoverageRate: coolingOut ? coolingOut.coolingCoverageRate : null,
    },
  };
}

module.exports = {
  // geometry
  declinationDeg,
  dayOfYear,
  solarAltitudeDeg,
  incidenceFactors,
  transpositionIndex,
  irradianceProfile,
  // pv
  cellTemperatureC,
  temperatureDerate,
  pvYield,
  // thermal
  sensibleHeatKw,
  streamRecovery,
  wasteHeatRecovery,
  thermalStorage,
  STORAGE_MEDIA,
  // electrical
  inverterCurrent,
  voltageDropPct,
  resistanceOhmPerKm,
  // cooling
  pvCoolingMatching,
  // simulation
  hourlyProfile,
  simulateDay,
  runSimulation,
};
