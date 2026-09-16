/**
 * Scenario presets for the SolarGlyph simulation service.
 *
 * Presets are complete, valid request bodies. The OpenClaw skill can submit a
 * preset by name (`{"preset": "industrial-rooftop-5mw"}`) or use one as a base
 * and override individual fields, which keeps the agent's job simple while the
 * numbers stay reviewable in one place.
 *
 * Reference irradiation values follow long-term annual horizontal GHI levels for
 * each region; the waste-heat streams are representative of an industrial park
 * (air compressors, a gas boiler, and a cooling-water loop).
 */

'use strict';

/** Reusable waste-heat stream definitions, expressed in SI units. */
const STREAM_LIBRARY = {
  airCompressor: {
    name: '空压机余热（oil-cooler）',
    massFlowKgS: 1.2,
    cpKjKgK: 1.005,
    deltaTK: 45,
    recoveryEfficiency: 0.72,
    availability: 0.82,
    pinchLimitKw: 220,
  },
  boilerFlueGas: {
    name: '燃气锅炉烟气余热',
    massFlowKgS: 3.4,
    cpKjKgK: 1.05,
    deltaTK: 120,
    recoveryEfficiency: 0.65,
    availability: 0.9,
    pinchLimitKw: 480,
  },
  coolingWater: {
    name: '循环冷却水余热',
    massFlowKgS: 12,
    cpKjKgK: 4.183,
    deltaTK: 8,
    recoveryEfficiency: 0.6,
    availability: 0.75,
    pinchLimitKw: 320,
  },
  inverterWasteHeat: {
    name: '逆变器/变压器散热回收',
    massFlowKgS: 2.5,
    cpKjKgK: 1.005,
    deltaTK: 18,
    recoveryEfficiency: 0.55,
    availability: 0.95,
    pinchLimitKw: 300,
  },
};

/**
 * Regional solar resource presets. `annualGhiKwhM2` is the horizontal-plane
 * annual irradiation used to drive the transposition model.
 */
const REGIONS = {
  shanghai: { label: '上海', latDeg: 31.23, lngDeg: 121.47, annualGhiKwhM2: 1300, annualMeanAmbientC: 17.6, noonAmbientC: 24 },
  xian: { label: '西安', latDeg: 34.34, lngDeg: 108.94, annualGhiKwhM2: 1400, annualMeanAmbientC: 14.5, noonAmbientC: 22 },
  beijing: { label: '北京', latDeg: 39.9, lngDeg: 116.4, annualGhiKwhM2: 1500, annualMeanAmbientC: 12.9, noonAmbientC: 21 },
  guangzhou: { label: '广州', latDeg: 23.13, lngDeg: 113.26, annualGhiKwhM2: 1250, annualMeanAmbientC: 22.4, noonAmbientC: 28 },
  lanzhou: { label: '兰州', latDeg: 36.06, lngDeg: 103.83, annualGhiKwhM2: 1650, annualMeanAmbientC: 10.3, noonAmbientC: 19 },
  yinchuan: { label: '银川', latDeg: 38.49, lngDeg: 106.23, annualGhiKwhM2: 1700, annualMeanAmbientC: 9.5, noonAmbientC: 18 },
};

const PRESET_LIST = [
  {
    id: 'industrial-rooftop-5mw',
    label: '工业厂区屋顶光伏 5MWp + 余热回收（默认场景）',
    description:
      '5 MWp 屋顶光伏 + 空压机/锅炉/冷却水三路余热回收 + 蓄热水箱。用于演示"启动光伏余热仿真"的完整链路。',
    request: {
      label: '工业厂区屋顶光伏 5MWp + 余热回收',
      site: { ...REGIONS.shanghai },
      array: {
        capacityKwp: 5000,
        tiltDeg: 22,
        azimuthDeg: 0,
        dcAcRatio: 1.2,
        systemLossFactor: 0.14,
        performanceRatio: 0.82,
        noctC: 45,
        gammaPerC: -0.0035,
      },
      wasteHeat: {
        streams: [STREAM_LIBRARY.airCompressor, STREAM_LIBRARY.boilerFlueGas, STREAM_LIBRARY.coolingWater],
        orcEfficiency: 0.12,
        heatUtilisationEfficiency: 0.85,
        gridEmissionFactorKgPerKwh: 0.581,
      },
      storage: {
        volumeM3: 200,
        deltaTK: 20,
        medium: 'water',
        insulationThicknessM: 0.1,
        insulationLambdaWmK: 0.035,
        chargePowerKw: 500,
        dischargePowerKw: 300,
      },
      electrical: { phase: '3p', uV: 400, peKw: 4000, kx: 0.9, cosPhi: 0.95, eta: 0.98, material: 'cu', sectionMm2: 185, lengthKm: 0.12, includeReactance: true },
    },
  },
  {
    id: 'industrial-rooftop-1mw',
    label: '中小型厂房屋顶光伏 1MWp + 余热回收',
    description: '1 MWp 光伏搭配空压机余热与冷却水余热的紧凑型方案，适合单栋厂房改造。',
    request: {
      label: '中小型厂房屋顶光伏 1MWp + 余热回收',
      site: { ...REGIONS.xian },
      array: { capacityKwp: 1000, tiltDeg: 25, azimuthDeg: 0, dcAcRatio: 1.15, systemLossFactor: 0.15, performanceRatio: 0.8, noctC: 45, gammaPerC: -0.0035 },
      wasteHeat: {
        streams: [STREAM_LIBRARY.airCompressor, STREAM_LIBRARY.coolingWater],
        orcEfficiency: 0.11,
        heatUtilisationEfficiency: 0.8,
      },
      storage: { volumeM3: 60, deltaTK: 18, medium: 'water', insulationThicknessM: 0.08, chargePowerKw: 200, dischargePowerKw: 120 },
      electrical: { phase: '3p', uV: 400, peKw: 800, kx: 0.85, cosPhi: 0.95, eta: 0.98, material: 'cu', sectionMm2: 120, lengthKm: 0.08 },
    },
  },
  {
    id: 'high-irradiance-10mw',
    label: '西北高辐照 10MWp 地面/屋顶光伏 + 余热',
    description: '银川地区 10 MWp 项目，高辐照 + 锅炉烟气余热，用于对比资源条件对发电量与余热品位的影响。',
    request: {
      label: '西北高辐照 10MWp 光伏 + 余热回收',
      site: { ...REGIONS.yinchuan },
      array: { capacityKwp: 10000, tiltDeg: 33, azimuthDeg: 0, dcAcRatio: 1.25, systemLossFactor: 0.13, performanceRatio: 0.84, noctC: 44, gammaPerC: -0.0034 },
      wasteHeat: {
        streams: [STREAM_LIBRARY.boilerFlueGas, STREAM_LIBRARY.inverterWasteHeat],
        orcEfficiency: 0.14,
        heatUtilisationEfficiency: 0.88,
      },
      storage: { volumeM3: 400, deltaTK: 25, medium: 'water', insulationThicknessM: 0.12, chargePowerKw: 1000, dischargePowerKw: 600 },
      electrical: { phase: '3p', uV: 690, peKw: 8000, kx: 0.9, cosPhi: 0.95, eta: 0.985, material: 'al', sectionMm2: 240, lengthKm: 0.2 },
    },
  },
  {
    id: 'pv-thermal-storage-cooling',
    label: '光伏蓄冷空调匹配（源自 SolarGlyph 工程页）',
    description:
      '复现 SolarGlyph 工程页的"光伏蓄冷空调"评估：光伏发电分配给冷机直供与蓄冷移峰，计算冷量覆盖率。使用 specificYield 路径以对齐原站模型。',
    request: {
      label: '光伏蓄冷空调匹配评估',
      site: { ...REGIONS.guangzhou },
      array: { capacityKwp: 1200, specificYieldKwhPerKwp: 1250, tiltDeg: 20, azimuthDeg: 0 },
      wasteHeat: {
        streams: [{ name: '冷机冷凝热回收', massFlowKgS: 8, cpKjKgK: 4.183, deltaTK: 6, recoveryEfficiency: 0.5, availability: 0.7, pinchLimitKw: 260 }],
        orcEfficiency: 0.1,
        heatUtilisationEfficiency: 0.75,
      },
      storage: { volumeM3: 120, deltaTK: 12, medium: 'water', insulationThicknessM: 0.1, chargePowerKw: 300, dischargePowerKw: 200 },
      cooling: {
        pvToCoolingShare: 0.55,
        directUseShare: 0.62,
        chillerCop: 3.8,
        storageRoundTripEfficiency: 0.82,
        annualCoolingDemandKwh: 2400000,
        operatingDays: 280,
        storageDischargeHours: 6,
      },
    },
  },
];

const PRESETS = PRESET_LIST.map(({ id, label, description, request }) => ({ id, label, description, request }));
const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

/** Resolve `{preset: id, ...overrides}` into a concrete request body. */
function applyPreset(input) {
  if (!input || typeof input !== 'object') return { request: {}, presetId: null };
  const { preset, ...rest } = input;
  if (!preset) return { request: rest, presetId: null };
  const found = PRESET_MAP.get(preset);
  if (!found) {
    const err = new Error(`unknown preset "${preset}"`);
    err.statusCode = 422;
    err.knownPresets = PRESETS.map((p) => p.id);
    throw err;
  }
  return {
    presetId: preset,
    request: {
      ...found.request,
      ...rest,
      site: { ...found.request.site, ...(rest.site || {}) },
      array: { ...found.request.array, ...(rest.array || {}) },
      wasteHeat: { ...found.request.wasteHeat, ...(rest.wasteHeat || {}) },
      storage: { ...found.request.storage, ...(rest.storage || {}) },
      electrical: { ...found.request.electrical, ...(rest.electrical || {}) },
    },
  };
}

module.exports = { PRESETS, PRESET_MAP, REGIONS, STREAM_LIBRARY, applyPreset };
