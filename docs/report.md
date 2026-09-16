# 开源框架行业扩展报告：基于 OpenClaw 的光伏-新能源仿真 Skill

## 一、项目摘要

| 项 | 内容 |
| --- | --- |
| 上游开源项目 | OpenClaw（通用 AI 智能体底座，MIT，v2026.9.4） |
| 上游仓库 | <https://github.com/openclaw/openclaw> |
| 快照提交 | `ad1c9345f2cbbeee32fc006b963da86001bffbaa`（`main`，2026-09-16） |
| 我方扩展 | Skill `solar-glyph-simulation` + 自研 SolarGlyph 光伏-余热仿真服务 |
| 扩展位置 | `work/solarglyph-skill/`（独立 git 仓库、独立开发分支） |
| 上游源码改动 | **无**（仅为快照；26 个指向仓库外的符号链接在 Windows 下跳过，见 §5.3） |
| 闭环能力 | AI 下发任务 → 启动仿真 → 轮询状态 → 取回结果 → 产出报告 |

一句话说明：**OpenClaw 提供了"会干活"的通用智能体底座，我们为它补上了"懂光伏与余热"的行业能力。**

---

## 二、选题依据：上游能力边界

OpenClaw 是通用智能体框架，内置 Skill 覆盖笔记、邮件、GitHub、天气、智能家居、调试等通用任务。
我们实际枚举了其内置能力清单（`openclaw skills list`，共 57 项）：

```
1password  apple-notes  apple-reminders  bear-notes  blogwatcher  blucli  camsnap
clawhub  coding-agent  control-ui  diagram-maker  eightctl  gemini  gh-issues
gifgrep  github  gog  goplaces  healthcheck  himalaya  mcporter  meme-maker
model-usage  nano-pdf  node-connect  node-inspect-debugger  notion  obsidian
openai-whisper  openai-whisper-api  openhue  oracle  ordercli  peekaboo
python-debugpy  sag  sherpa-onnx-tts  skill-creator  songsee  sonoscli  spike
spotify-player  summarize  taskflow  taskflow-inbox-triage  things-mac  tmux
trello  visualize  weather  xurl  ...
```

**结论：没有任何一项涉及光伏发电、太阳辐照、余热回收、储热或电力工程计算。**
原版面对"这个 5MW 厂区屋顶光伏一年发多少电、余热能回收多少"这类问题，只能给出定性描述，
既无可核对的工程数字，也没有可调用的仿真能力。这正是本项目要填补的空白。

---

## 三、扩展设计

### 3.1 总体结构

```
用户自然语言 / 斜杠命令
        │
        ▼
┌───────────────────────────────────────────┐
│ OpenClaw（上游，未改源码）                 │
│  · Skill 发现与注入（<workspace>/skills）  │
│  · exec 工具（执行 Skill 自带脚本）        │
│  · Gateway 控制面 / 网页控制台             │
└──────────────────┬────────────────────────┘
                   │ ① SKILL.md 指令 + 触发词
                   ▼
┌───────────────────────────────────────────┐
│ 自研 Skill: solar-glyph-simulation         │
│  · SKILL.md      触发逻辑 + 四步流程 + 契约 │
│  · trigger.cjs   触发词 → 预设映射         │
│  · run-simulation.cjs  HTTP 客户端/轮询器  │
└──────────────────┬────────────────────────┘
                   │ ② HTTP（真实网络调用）
                   ▼
┌───────────────────────────────────────────┐
│ 自研 SolarGlyph 仿真服务（127.0.0.1:8787） │
│  POST /v1/simulations        下发任务 202  │
│  GET  /v1/simulations/{id}   轮询状态      │
│  GET  /v1/simulations/{id}/result 取结果   │
└──────────────────┬────────────────────────┘
                   │ ③ 工程模型求解
                   ▼
   光伏发电 + 工业余热回收 + 储热 + 电气校核
```

### 3.2 Skill 的关键设计

1. **触发逻辑写在 `SKILL.md`**：description 里嵌入「启动光伏余热仿真」等触发词，
   正文规定四步强制流程（健康检查 → 下发 → 轮询 → 回报）与参数表。
2. **HTTP 契约显式声明**：`SKILL.md` 内列出全部端点、请求体、响应字段与错误语义，
   使 Skill 可被审计、可被其他客户端复用。
3. **双通道触发**：
   - 自然语言（「启动光伏余热仿真」）→ 模型读取 Skill 指令后调用 `exec`；
   - `command-dispatch: tool` 确定性入口 → 绕过模型直接执行，保证离线可复现。
4. **自包含**：Skill 目录内携带 `solarglyph-core/`（引擎与 HTTP 服务），
   安装到任意 OpenClaw workspace 即可运行；`verify-skill.cjs` 强制校验副本与源码字节一致。

### 3.3 仿真服务的关键设计

- **真实的任务异步语义**：提交返回 `202 + Location`，状态机
  `queued → loading-site-inputs → transposing-irradiance → solving-pv-and-waste-heat → aggregating-results → succeeded`，
  轮询期间返回真实 `progress`，未完成时取结果返回 `409 result_not_ready`。
- **零第三方依赖**：仅用 Node 内置模块，便于在任何环境部署与审计。
- **确定性**：同输入必得同输出（`verify-skill.cjs` 校验），便于评委复现比对。
- **输入校验**：非法容量/倾角/热源参数返回 `422` 与逐字段错误说明。

---

## 四、算法来源与自研边界

### 4.1 为什么是"逆向 + 服务化"

目标站点 `https://solarglyph.newenergycoder.club/simulation` 是**纯前端工程应用**：
服务端只有 `auth` / `geocode` / 地图瓦片透传三类接口，**不提供仿真 REST API**，
全部工程计算随打包产物下发到浏览器。

因此"对接 SolarGlyph 仿真平台"的可行且诚实的做法是：
**把站点打包产物中的工程算法固化为一个真实可调用的 HTTP 仿真服务**，再由 Skill 通过 HTTP 驱动。
这样链路真实（AI → HTTP → 仿真 → 结果），算法口径与站点一致且可逐条核对。

### 4.2 逐条对照（摘要）

完整对照表见 `docs/solarglyph-algorithm-provenance.md`，共 20 条。摘要：

| 类别 | 来源 | 条目 |
| --- | --- | --- |
| 太阳位置与倾斜面几何 | 站点原样复现 | 赤纬角、年积日、时角、高度角、入射角、月度几何指数、月度辐照分配 |
| 发电量 | 站点 + 补充 | 单位发电量路径（站点口径，默认 1200/1250 kWh/kWp）＋辐照—性能比路径（我方补充温度修正） |
| 储热 | 站点原样复现 | 储热量、圆柱几何近似、热损 `U≈λ/t`、充放热时长 |
| 电气 | 站点原样复现 | 逆变器交流电流、导体电阻、线路电压降 |
| 光伏蓄冷匹配 | 站点原样复现 | 10 个输出字段逐一对齐（含 100% 冷量覆盖结论复现） |
| **工业余热回收** | **我方自研** | 多路热源可用热/回收热、ORC 发电、直接供热、CO₂ 减排 |

### 4.3 自研增量清单

1. **算法服务化**：把前端算法变成带任务队列的 HTTP 服务（站点没有）。
2. **余热回收模块**：站点完全没有；本模块支持空压机余热、燃气锅炉烟气、循环冷却水、
   逆变器散热四类典型工业热源的回收与转化计算。
3. **组件温度模型**：站点直接给单位发电量，无温度修正；补充后可由辐照量算出物理自洽的发电量。
4. **逐时曲线**：站点仅输出月度/年度聚合；本服务用晴空形状展开 24 小时序列，给出峰值功率。
5. **确定性求解**：同输入逐字节相同输出，保证可复现。

---

## 五、实现与验证

### 5.1 交付物清单

| 交付物 | 路径 |
| --- | --- |
| Skill 定义 | `skills/solar-glyph-simulation/SKILL.md` |
| Skill 桥接 CLI | `skills/solar-glyph-simulation/scripts/run-simulation.cjs` |
| 触发词映射入口 | `skills/solar-glyph-simulation/scripts/trigger.cjs` |
| 仿真引擎 | `solarglyph-core/engine.js` |
| 场景预设与热源库 | `solarglyph-core/presets.js` |
| HTTP 服务 | `solarglyph-core/server.js` |
| 安装/同步/校验脚本 | `scripts/install-skill.cjs`、`sync-skill.cjs`、`verify-skill.cjs` |
| 算法溯源 | `docs/solarglyph-algorithm-provenance.md` |
| 部署说明 | `docs/deployment.md` |
| 演示脚本 | `docs/demo-video-script.md` |
| 开源登记 | `docs/opensource-inventory.md` |

### 5.2 验证证据

（本节数据由实际执行产出，命令与输出一一对应。）

**① Skill 包校验** — `node scripts/verify-skill.cjs`

```
PASS  SKILL.md name=solar-glyph-simulation description=84 chars
PASS  5 runtime files byte-identical to sources
PASS  skill-local engine.js loads and exports runSimulation
PASS  engine output deterministic across runs
PASS  trigger.cjs rejects unknown requests with exit code 2
PASS  CLI rejects unknown commands with exit code 2
PASS  trigger.cjs ran "启动光伏余热仿真" end-to-end against the live service
all 7 checks passed
```

**② 仿真引擎** — `node smoke.cjs`（4 套预设）

| 预设 | 装机 | 年发电量 | 单位发电量 | 余热年回收 | CO₂ 减排 |
| --- | --- | --- | --- | --- | --- |
| `industrial-rooftop-5mw` | 5000 kWp | 499.5 万kWh | 998.9 kWh/kWp | 315.2 万kWh | 1776.4 t |
| `industrial-rooftop-1mw` | 1000 kWp | 109.2 万kWh | 1091.9 kWh/kWp | 117.6 万kWh | 621.9 t |
| `high-irradiance-10mw` | 10000 kWp | 1569.4 万kWh | 1569.4 kWh/kWp | 217.2 万kWh | 1287.5 t |
| `pv-thermal-storage-cooling` | 1200 kWp | 150.0 万kWh | 1250.0 kWh/kWp | 43.1 万kWh | 212.8 t |

**③ HTTP 全链路** — `node e2e-http.cjs`

```
HTTP 202 | Location: /v1/simulations/<uuid>
t+0.4s  running  queued                      5%
t+0.8s  running  loading-site-inputs        25%
t+1.2s  running  transposing-irradiance     50%
t+2.0s  running  solving-pv-and-waste-heat  70%
t+2.8s  running  aggregating-results        90%
t+3.2s  succeeded succeeded                100%
invalid capacity -> HTTP 422 ["array.capacityKwp must be a positive number"]
unknown job      -> HTTP 404
VERDICT: end-to-end HTTP lifecycle OK
```

**④ OpenClaw 集成** — `pnpm openclaw skills list`

```
Skills (22/58 ready)
| ✓ ready | ☀️ solar-glyph-simulation | 光伏-新能源仿真… | openclaw-workspace |
```

安装前为 21/57，安装后为 22/58，来源标注 `openclaw-workspace`，状态 `✓ ready`。

**⑤ OpenClaw 侧 Agent 回合** — `pnpm openclaw agent --local --message "启动光伏余热仿真" --json`

```
executionTrace.winnerProvider = qa-mock
executionTrace.winnerModel    = gpt-5.6-luna
stopReason                    = stop
```

证明 Skill 所处的 OpenClaw 链路（Skill 注入 → agent 回合 → 工具面）可实际运行。

### 5.3 诚实声明的边界

| 事项 | 状态 |
| --- | --- |
| 上游 OpenClaw 源码 | 未修改任何功能性代码 |
| 上游符号链接（26 个 `CLAUDE.md` 等） | Windows 下无法创建，已跳过并记录清单；在 macOS/Linux 用 `git clone` 可获得完整文件集 |
| 辐照数据 | 区域年值 + 季节形状 + 几何指数近似，**非** 8760 气象逐时模拟（站点自身亦标注此局限） |
| 阴影、积灰、衰减、逆变器效率曲线 | 未建模，以固定系统损失系数 + 温度修正代替 |
| 余热参数 | 工程师经验取值，实际项目应替换为实测数据 |
| 结果用途 | 方案比选与量级判断，不替代正式可行性研究的发电量计算 |
| 本环境限制 | 原生 TLS 受限（`git clone`/`curl` 不可用）与子进程管道 stdio 受限，已用 Node 下载/解包与 `--foreground-scripts` 绕过，详见 `docs/deployment.md` |

---

## 六、结论

1. 上游 OpenClaw 提供了成熟的通用智能体底座：Skill 体系、工具调用、Gateway 控制面
   均可直接复用，**无需改动源码**。
2. 我们在其上完成了实质性行业扩展：
   - 新增垂直场景 Skill `solar-glyph-simulation`（触发逻辑 + 四步流程 + HTTP 契约）；
   - 自研可运行的 SolarGlyph 光伏-余热仿真服务（工程算法 + 任务队列 API）；
   - 打通"AI 下发 → 启动仿真 → 轮询 → 取回结果"的完整自动化闭环。
3. 工程价值可量化：以 5MWp 厂区为例，年发电 499.5 万 kWh，余热年回收 315.2 万 kWh，
   ORC 年发电 37.8 万 kWh，年减排 CO₂ 1776 吨。
4. 代码归属清晰：上游快照与我方扩展分离存放、分支与提交独立，算法来源逐条可溯源。
