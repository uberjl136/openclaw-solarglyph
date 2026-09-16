# SolarGlyph 算法溯源说明

本文说明 `solarglyph-core/engine.js` 中每个公式的来源，以及哪些部分是**本团队自研扩展**。
目的：让评委能逐条核对「自研 Skill 到底做了什么」，而不是只看一段自我介绍。

## 1. 为什么需要"溯源"而不是直接调用

目标站点 `https://solarglyph.newenergycoder.club/simulation` 是一个**纯前端工程应用**：

- 服务端只有三类接口：`/api/auth/session`、`/api/auth/logout`、`/api/geocode`，以及一个用于地图瓦片的透传 `/api/windy/...`。
- 也就是说，该站点**不提供仿真 REST API**，全部工程计算都在浏览器端完成，随打包产物一起下发。

因此"对接 SolarGlyph 仿真平台"的可行做法是：把站点打包产物里的**工程算法固化成一个真实可调用的 HTTP 仿真服务**，
再由 OpenClaw Skill 通过 HTTP 驱动它。这样链路是真实的（AI → HTTP → 仿真 → 结果），
且算法口径与站点一致、可逐条核对。

核查方法（可复现）：

```bash
# 1. 取站点页面与主包
curl -s https://solarglyph.newenergycoder.club/simulation            # index.html
curl -s https://solarglyph.newenergycoder.club/assets/index-BQN0yBzB.js -o app.js
# 2. 压缩产物美化后按行核对下表
```

本仓库的取证副本位于 `work/recon/solarglyph-app.js`（原始压缩包）与
`work/recon/solarglyph-app.pretty.js`（美化后，17,510 行）。

## 2. 逐条公式对照表

下表行号指美化后产物 `work/recon/solarglyph-app.pretty.js` 的行号；`engine.js` 列为本仓库实现。

| # | 工程含义 | 站点实现位置 | 站点原始公式 | 本仓库实现 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | 赤纬角 | L13825 `bo()` | `23.45*sin(360*(284+n)/365)` | `declinationDeg()` | Cooper 方程，完全一致 |
| 2 | 年积日 | L13821 `yo()` | `floor((t-1/1)/86400000)` | `dayOfYear()` | 完全一致 |
| 3 | 时角 | L13829 | `(hour-12)*15` | `hourAngleDeg()` | 完全一致 |
| 4 | 太阳高度角 | L13829 `Zm()` | `sin(lat)sin(dec)+cos(lat)cos(dec)cos(ha)` | `solarAltitudeDeg()` | 完全一致 |
| 5 | 倾斜面入射角 | L13834 `Qm()` | 三项展开式 `cosTheta` / `cosZenith` | `incidenceFactors()` | 系数与钳位区间 `[-1,1]` 一致 |
| 6 | 月度倾斜面几何指数 | L13838–13858 `Cn()` | 取 12 个代表日（15/45/…/349）× 3 个时刻（9/12/15 时），`Σmax(0,cosθ)/Σmax(0,cosθz)`，再取 12 月均值 | `transpositionIndex()` | 代表日与时刻表原样保留 |
| 7 | 月度辐照分配 | L14189 | 无月度序列时按季节形状 `[.05,.05,.08,.09,.1,.11,.12,.11,.09,.08,.06,.06]` 归一化分配年 GHI，再逐月乘几何指数 | `irradianceProfile()` | 形状数组原样保留 |
| 8 | 组件温度 | — | 站点未建模（直接给单位发电量） | `cellTemperatureC()` | **本项目补充**：`T_cell=T_amb+(NOCT-20)*G/800` |
| 9 | 温度修正 | — | 站点未建模 | `temperatureDerate()` | **本项目补充**：`1+γ(T_cell-25)`，γ 默认 -0.35%/°C |
| 10 | 发电量（单位发电量路径） | L12204、L12193、L13562 | `capacity*1200`、`capacity*1250` | `pvYield()` 的 `specific-yield` 分支 | 站点的真实口径，默认值原样保留 |
| 11 | 发电量（辐照路径） | — | 站点未直接给出 | `pvYield()` 的 `irradiance-performance-ratio` 分支 | **本项目补充**：`POA×PR×(1-γ温度修正)×(1-系统损失)` |
| 12 | 储热量 | L15351–15352 | `E=ρ·V·cp·ΔT/3600` | `thermalStorage()` | 完全一致（含介质物性表） |
| 13 | 储罐几何近似 | L15351 | `H=D → D=(4V/π)^(1/3)`，`A=πDH+πD²/2` | `thermalStorage()` | 完全一致 |
| 14 | 储罐热损 | L15351 | `U≈λ/t`，`P_loss=U·A·ΔT/1000` | `thermalStorage()` | 完全一致 |
| 15 | 充放热时长 | L15352 | 理想 `t=E/P`；含热损 `t=E/(P+P_loss)`、`E/(P_charge-P_loss)` | `thermalStorage()` | 完全一致 |
| 16 | 逆变器交流电流 | L13866 `th()` | `I=P_js·1000/(√3·U·cosφ·η)` | `inverterCurrent()` | 完全一致（单相用 2 系数） |
| 17 | 导体电阻 | L13860–13862 | 铜 `17.5/S`、铝 `28.5/S`（S 下限 0.5） | `resistanceOhmPerKm()` | 完全一致 |
| 18 | 线路电压降 | L13873 `nh()` | `ΔU=k·I·(R·cosφ+X·sinφ)·L`，`k=√3` 或 `2` | `voltageDropPct()` | 完全一致 |
| 19 | 光伏蓄冷匹配 | L13562 `Rm()` | 见下方独立说明 | `pvCoolingMatching()` | 完全一致，含 10 个输出字段 |
| 20 | 余热回收 | — | 站点无此模块 | `wasteHeatRecovery()` / `streamRecovery()` | **本项目自研扩展**，见第 4 节 |

### 第 19 项：站点 `Rm()` 逐字对照

站点原文（L13562）：

```js
d = s*n                       // 年发电量 = 容量 × 单位发电量
g = d*a                       // 分配给制冷的电量
x = g*i*r                     // 直供冷量 = 电量 × 直供比例 × COP
m = g*(1-i)*l*r               // 蓄冷移峰冷量 = 电量 × 蓄冷比例 × 往返效率 × COP
b = x+m
f = min(o, b)                 // 光伏实际满足的冷量
v = max(0, o-f)               // 电网补冷
p = max(0, b-o)               // 冗余冷量潜力
j = o>0 ? f/o : 0             // 冷量覆盖率
N = C/c/h                     // 推荐蓄冷释冷功率
```

本仓库 `pvCoolingMatching()` 一一对应，字段名沿用站点语义
（`pvAnnualGenerationKwh` / `directCoolingKwh` / `storageShiftedCoolingKwh` / `coolingCoverageRate` …），
并在 `presets.js` 的 `pv-thermal-storage-cooling` 预设中复现站点默认参数
（1200 kW / 1250 kWh·kW⁻¹ / 0.55 / 0.62 / COP 3.8 / 0.82 / 240 万 kWh / 280 天 / 6 h）。

## 3. 与站点的差异（明确声明）

1. **站点不提供 HTTP 仿真接口，本服务提供。** 这是本项目的主要工程增量：把前端算法服务化。
2. **本服务补充了组件温度/温度系数模型**（第 8、9 项）。站点只暴露"单位发电量"输入，
   没有温度修正；补充该模型后，服务才能从辐照量算出物理上自洽的发电量。
3. **本服务补充了逐时曲线。** 站点只输出月度/年度聚合值；本服务用晴空正弦形状把日均
   POA 展开成 24 小时序列，因此能给出峰值功率与曲线，便于 Skill 呈现。
4. **本服务的求解是确定性的**：同样输入必然得到逐字节相同的输出（`verify-skill.cjs` 会检查），
   便于评委复现与比对。

## 4. 自研扩展：工业余热回收模块

站点覆盖"光伏 + 储热 + 蓄冷空调"，但**没有余热回收**。这正是本 Skill 相对上游与站点的第二个增量。

实现要点：

- `streamRecovery()`：单路热源
  `Q_avail = ṁ·c_p·ΔT`；
  `Q_recovered = min(Q_avail, Q_pinch) × η_recovery × availability`；
  年回收热量 `Q_recovered × 8760 × availability`。
- `wasteHeatRecovery()`：多路汇总，并给出两种可用能转化
  - ORC 发电：`E_ORC = Q_year × η_ORC`（默认 12%）
  - 直接供热：`E_heat = Q_year × η_heat`（默认 85%）
  - 减排量：`(E_ORC + E_heat) × 电网排放因子`（默认 0.581 kgCO₂/kWh）
- 热源库（`presets.js` 的 `STREAM_LIBRARY`）覆盖空压机余热、燃气锅炉烟气、循环冷却水、
  逆变器/变压器散热四类典型工业热源，参数为工程常用取值范围。

## 5. 已知局限

- 辐照数据用区域年值 + 季节形状 + 倾斜面几何指数近似，**不是** 8760 小时气象数据逐年模拟；
  站点自身也标注"为简化几何模型估算，不替代气象 8760 计算"（L14174）。
- 未建模阴影、积灰时序、组件衰减与逆变器效率曲线（本服务用固定系统损失系数与温度修正代替）。
- 余热热源的 `availability`、`recoveryEfficiency` 为工程师经验取值，实际项目应替换为实测数据。
- 结果用于方案比选与量级判断，不用于替代可行性研究报告中的正式发电量计算。
