---
name: solar-glyph-simulation
description: "光伏-新能源仿真：调用 SolarGlyph 仿真平台下发光伏发电与余热回收仿真任务，轮询作业状态并产出仿真结果报告。触发词：启动光伏余热仿真、光伏仿真、余热回收仿真。"
user-invocable: true
command-dispatch: tool
command-tool: exec
command-arg-mode: raw
homepage: https://solarglyph.newenergycoder.club/simulation
metadata:
  {
    "openclaw":
      {
        "emoji": "☀️",
        "requires": { "bins": ["node"] },
      },
  }
---

# 光伏-新能源仿真（SolarGlyph）

面向光伏发电 + 工业余热回收的**垂直场景**能力：把一次「仿真需求」变成 下发任务 → 轮询状态 → 取回结果报告 的完整闭环。

上游 OpenClaw 是通用智能体底座，自身不具备任何光伏/余热工程计算能力；本 Skill 通过 HTTP 把仿真任务交给自研的 **SolarGlyph 仿真服务**，并在会话里回报可核对的工程指标。这也是本仓库相对上游的唯一实质扩展。

## 触发条件

出现下列任一意图时执行本流程：

- 「启动光伏余热仿真」/「跑一下光伏仿真」/「光伏+余热仿真」
- 「算一下这个厂区屋顶光伏的发电量」「余热回收能省多少」「光伏蓄冷匹配」
- 用户给出了厂区容量、辐照、余热热源等参数并要求评估

用户没有给参数时，**不要追问**，直接用默认场景 `industrial-rooftop-5mw` 跑通，再在回复里说明所用参数，并询问是否调整。

> **给模型的硬性要求**：命中上述意图后，**第一个动作必须是调用 `exec` 工具**执行下面第 1 步的命令。
> 不要先回答"无法执行"、不要询问是否创建会话、不要讨论会话/子代理状态——
> 这是一个本地脚本调用，直接执行即可。命令返回结果后再用自然语言总结给用户。

## 执行流程（必须按顺序完成四步）

### 第 1 步：确认仿真服务在线

```bash
node {baseDir}/scripts/run-simulation.cjs health
```

- 返回 `"status": "ok"` → 继续。
- 报连接失败（`ECONNREFUSED`）→ 说明服务没起来，先启动它，再重试：

```bash
node {baseDir}/solarglyph-core/server.js
```

在 OpenClaw 里用后台方式启动（例如 `exec` 的 `background: true`），启动后等 1 秒再执行第 1 步。**服务端口默认 `127.0.0.1:8787`**，可用环境变量 `SOLARGLYPH_PORT` 覆盖。

### 第 2 步：下发仿真任务

```bash
node {baseDir}/scripts/run-simulation.cjs run --preset industrial-rooftop-5mw --format text
```

该命令自身完成「提交 → 轮询 → 取结果」，进度会打到 stderr。可用参数：

| 参数 | 含义 |
| --- | --- |
| `--preset <id>` | 场景预设，见第 4 步的列表 |
| `--capacity <kWp>` | 光伏装机容量（kWp） |
| `--tilt <°>` / `--azimuth <°>` | 倾角 / 方位角 |
| `--lat <°>` / `--ghi <kWh/m²>` | 纬度 / 水平面年辐照量 |
| `--input <file.json>` | 自定义完整参数（含余热热源列表） |
| `--format text\|json\|markdown\|summary` | 输出格式，默认 `text` |
| `--report <path.md>` | 额外写出 Markdown 报告 |

自定义余热热源时用 `--input`，结构示例：

```json
{
  "label": "某厂余热回收评估",
  "site": { "latDeg": 31.23, "annualGhiKwhM2": 1300 },
  "array": { "capacityKwp": 3000, "tiltDeg": 22, "azimuthDeg": 0 },
  "wasteHeat": {
    "streams": [
      { "name": "空压机余热", "massFlowKgS": 1.2, "cpKjKgK": 1.005, "deltaTK": 45, "recoveryEfficiency": 0.72, "availability": 0.82 }
    ],
    "orcEfficiency": 0.12,
    "heatUtilisationEfficiency": 0.85
  }
}
```

### 第 3 步：单独轮询（任务较长时）

提交与轮询是分离的 HTTP 语义，任务耗时长时可先提交再轮询：

```bash
node {baseDir}/scripts/run-simulation.cjs submit --preset industrial-rooftop-5mw   # 拿到 job id
node {baseDir}/scripts/run-simulation.cjs status <job-id>                          # 轮询，直到 succeeded
node {baseDir}/scripts/run-simulation.cjs result <job-id> --format text            # 取结果
```

作业阶段依次为 `queued → loading-site-inputs → transposing-irradiance → solving-pv-and-waste-heat → aggregating-results → succeeded`。

### 第 4 步：回报结果

- 直接把命令输出里的关键指标讲给用户：**年发电量、单位发电量、余热年回收热量、ORC 发电量、年减排 CO₂**。
- 需要留档时加 `--report <path>.md`，再让用户查看该文件。
- 明确区分**仿真输出**与**你的推断**，不要把估算值说成实测值。

查看可用场景：

```bash
node {baseDir}/scripts/run-simulation.cjs presets
```

内置预设：

| preset | 场景 |
| --- | --- |
| `industrial-rooftop-5mw` | 工业厂区屋顶光伏 5MWp + 三路余热回收（默认） |
| `industrial-rooftop-1mw` | 中小型厂房 1MWp + 空压机/冷却水余热 |
| `high-irradiance-10mw` | 西北高辐照 10MWp + 锅炉烟气余热 |
| `pv-thermal-storage-cooling` | 光伏蓄冷空调匹配（复现 SolarGlyph 工程页算法） |

## 确定性入口（无模型调度）

本 Skill 在 frontmatter 里声明了 `command-dispatch: tool` + `command-tool: exec`，
因此斜杠命令会**绕过模型**直接执行 `scripts/trigger.cjs`，把用户输入映射成一次仿真：

```
/solar-glyph-simulation 启动光伏余热仿真     →  industrial-rooftop-5mw
/solar-glyph-simulation 光伏蓄冷空调         →  pv-thermal-storage-cooling
/solar-glyph-simulation 西北高辐照 10MW      →  high-irradiance-10mw
/solar-glyph-simulation 小型厂房 1MW         →  industrial-rooftop-1mw
```

也可以直接指定预设：`/solar-glyph-simulation --preset industrial-rooftop-1mw`。

这条路径不依赖模型推理，适合离线环境、CI 或演示时保证结果可复现；
自然语言触发（「启动光伏余热仿真」）走正常模型路径，由本文件的指令引导执行同一套 CLI。

## HTTP 接口（SolarGlyph 仿真平台契约）

服务默认 `http://127.0.0.1:8787`，全部为 JSON。CLI 只是这层接口的封装；需要直接调用时按此契约：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/health` | 存活状态与模型元信息 |
| `GET` | `/v1/models` | 场景预设列表 |
| `POST` | `/v1/validate` | 只校验参数，不下发任务 |
| `POST` | `/v1/simulations` | **下发任务**，返回 `202` + `Location: /v1/simulations/{id}` |
| `GET` | `/v1/simulations/{id}` | **轮询状态**：`status`、`stage`、`progress` |
| `GET` | `/v1/simulations/{id}/result` | **取回结果**；未完成返回 `409 result_not_ready` |
| `DELETE` | `/v1/simulations/{id}` | 删除任务 |
| `GET` | `/v1/simulations` | 任务列表 |

请求体示例（`POST /v1/simulations`）：

```json
{
  "preset": "industrial-rooftop-5mw",
  "label": "演示任务",
  "array": { "capacityKwp": 5000 },
  "wasteHeat": { "orcEfficiency": 0.12 }
}
```

响应字段：`id`、`status`、`stage`、`progress`、`presetId`、`links.result`。结果体包含 `result.summary`（关键指标）、`result.wasteHeat.streams`（各路热源）、`result.representativeDay.series`（代表日 24 小时曲线）。

## 安全与边界

- 服务只监听 `127.0.0.1`，不要把它暴露到公网。
- 参数来自用户输入时，通过 CLI 参数或 `--input` 文件传入，**不要**把用户文本拼接进 shell 命令。
- 仿真结果是工程估算，用于方案比选；结论要说明所用假设（辐照数据、余热温度、回收效率等）。
- 模型来源与公式出处见仓库 `docs/solarglyph-algorithm-provenance.md`。
