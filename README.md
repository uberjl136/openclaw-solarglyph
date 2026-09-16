# OpenClaw × SolarGlyph：光伏-新能源仿真 Skill

把一个**通用智能体底座**变成能干活的新能源仿真助手：在 OpenClaw 里说一句
「**启动光伏余热仿真**」，它会自动下发仿真任务、轮询作业状态、取回结果并产出工程指标报告。

本仓库 = **上游 OpenClaw 快照** + **本团队自研的新能源仿真 Skill / 仿真服务**。
两者边界见下方[仓库结构](#仓库结构)。

---

## 一、这不是"只部署了开源项目"

比赛明确排除"仅部署开源项目、无实质改进"。本仓库的实质改进有三处，均可独立核验：

| 改进 | 内容 | 核验位置 |
| --- | --- | --- |
| ① 新增垂直场景 Skill | `solar-glyph-simulation`：定义触发词、四步执行流程、HTTP 契约、参数表 | `work/solarglyph-skill/skills/solar-glyph-simulation/SKILL.md` |
| ② 新增仿真服务 | SolarGlyph 工程算法服务化：光伏发电 + 工业余热回收，提供真实的 提交/轮询/取结果 HTTP API | `work/solarglyph-skill/solarglyph-core/` |
| ③ 打通端到端链路 | AI 指令 → HTTP 下发 → 轮询 → 结果回传，全自动跑通 | 见[实测证据](#六实测证据) |

**上游 OpenClaw 底层源码未做任何修改**（唯一例外是仓库根目录新增本 Skill，以及 `CLAUDE.md` 类符号链接无法在 Windows 落地，详见[§5.3](#53-windows-平台的已知差异)）。

### 原版做不到什么

OpenClaw 本身是一个通用智能体框架，它的 50 个内置 Skill 覆盖笔记、邮件、GitHub、天气、智能家居等
通用任务，**没有任何光伏、辐照、余热、热力或电力工程计算能力**：

```bash
# 上游快照里的内置 skills（无任何新能源相关能力）
ls upstream/openclaw-main/skills
```

加载本 Skill 之前，问它「这个 5MW 厂区屋顶光伏一年发多少电」，它只能给出泛泛的定性回答，
拿不到可核对的工程数字；加载之后，它会真正调用仿真服务跑出结果。
这一对比就是[演示视频](docs/demo-video-script.md)的第一幕。

---

## 二、仓库结构

```
DS Harness/
├── upstream/openclaw-main/          ← 上游原版 OpenClaw（通用 AI 智能体底座，未改源码）
│   ├── src/  extensions/  packages/  ui/  docs/
│   └── skills/                      ← 上游内置的 50 个通用 Skill（无新能源能力）
│
└── work/solarglyph-skill/           ← 本团队自研部分（独立 git 仓库）
    ├── skills/solar-glyph-simulation/   ← ★ 可安装的 Skill 包
    │   ├── SKILL.md                     ← 触发逻辑 + 执行流程 + HTTP 契约
    │   ├── scripts/run-simulation.cjs   ← Skill ↔ 仿真服务的桥接 CLI
    │   └── solarglyph-core/             ← 随包携带的仿真算力（自包含）
    ├── solarglyph-core/                 ← 仿真服务源码（权威副本）
    │   ├── engine.js                    ← 光伏/余热工程模型
    │   ├── presets.js                   ← 场景预设与热源库
    │   └── server.js                    ← HTTP 任务队列服务
    ├── scripts/                         ← 安装、同步、校验脚本
    └── docs/                            ← 算法溯源、部署、演示与报告
```

**上游 vs 自研 的判定线**：`upstream/` 下所有文件来自官方仓库快照，只读不改；
`work/solarglyph-skill/` 下所有文件为本团队原创，单独成库、单独提交。

---

## 三、快速开始

### 3.1 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | `>=24.16.0 <25` 或 `>=26.1.0` | 与上游 `package.json` 的 `engines` 一致 |
| pnpm | `12.3.4` | 上游 `packageManager` 锁定版本 |
| git | 任意较新版本 | 仅提交/推送需要 |

> 仿真服务本身**零第三方依赖**（只用 `node:http`），不装 OpenClaw 也能单独跑。

### 3.2 跑通仿真服务（30 秒）

```bash
cd work/solarglyph-skill
node solarglyph-core/server.js          # 监听 127.0.0.1:8787
```

另开一个终端：

```bash
node scripts/run-simulation.cjs health                     # 存活检查
node scripts/run-simulation.cjs presets                    # 可用场景
node scripts/run-simulation.cjs run --preset industrial-rooftop-5mw
node scripts/run-simulation.cjs run --preset industrial-rooftop-5mw --report out.md
```

### 3.3 在 OpenClaw 中加载 Skill

```bash
# 1) 准备上游依赖（首次约需数分钟）
cd upstream/openclaw-main
pnpm install --frozen-lockfile

# 2) 把 Skill 安装进 OpenClaw workspace
cd ../../work/solarglyph-skill
node scripts/install-skill.cjs

# 3) 启动 Gateway 并在浏览器打开控制台
cd ../../upstream/openclaw-main
pnpm openclaw gateway          # 控制台默认 http://127.0.0.1:18789/
```

然后在网页会话里直接输入：

```
启动光伏余热仿真
```

### 3.3.1 模型从哪来

OpenClaw 需要一个模型来驱动对话。**离线环境可以用本地 Ollama**，无需任何云端凭据：

```bash
ollama pull qwen3:4b                  # 建议 4B 以上，小模型难以稳定编排工具调用
```

在 `$OPENCLAW_STATE_DIR/openclaw.json` 里配置：

```json5
{
  gateway: { mode: "local" },
  // 完整工具面：exec 属于 group:runtime，缺省 profile 可能不暴露它
  tools: { profile: "full", toolSearch: false },
  models: {
    providers: {
      ollama: { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama-local", api: "openai-completions" }
    }
  },
  agents: { defaults: { model: "ollama/qwen3:4b" } }
}
```

> 本地模型默认会启用 Tool Search（把工具藏到 `tool_search`/`tool_call` 代理后面），
> 小模型往往因此编排失败；上面的 `tools.toolSearch: false` 让 `exec` 直接可见。

### 3.4 一键自检

```bash
cd work/solarglyph-skill
node scripts/verify-skill.cjs    # Skill 包完整性、自包含性、确定性、触发链路
node smoke.cjs                   # 四套预设场景全部跑通
# 需要服务在线时：
node e2e-http.cjs                # 提交 → 轮询 → 取结果 全链路

# 模型驱动路径复测（需一个能力足够的模型）
node scripts/test-model-driven.mjs --model ollama/qwen3:8b
```

> **关于触发方式**：两条入口共用同一个 CLI，都已实测跑通。
>
> | 入口 | 机制 | 实测状态 |
> | --- | --- | --- |
> | `/solar-glyph-simulation` 或 `trigger.cjs` | `command-dispatch: tool` 确定性调度，绕过模型 | **闭环**（离线可用，最可靠） |
> | 自然语言「启动光伏余热仿真」 | 模型读取 SKILL.md 后调用 `exec` | **闭环**，但需下面的精简配置；可靠性随模型规模变化 |
>
> 让本地小模型也能跑通的精简配置（本机 8B 模型据此成功调用 `exec` 并产出仿真结果）：
>
> ```json5
> {
>   tools: { profile: "full", toolSearch: false, allow: ["read", "exec"] },
>   agents: { defaults: { skipBootstrap: true, contextInjection: "never" } }
> }
> ```
>
> 原因：默认系统提示里的工具 schema 约 66 KB，加上工作区引导文件会把小模型的注意力带偏；
> 收窄到 `read`+`exec` 后降到约 2.6 KB，模型即可正确调用。
> 一键复测：`node scripts/test-model-driven.cjs --model ollama/qwen3:8b`。
> 完整测试矩阵与服务端任务历史证据见
> [`docs/verification-evidence.md`](docs/verification-evidence.md) §2。

---

## 四、Skill 如何工作

```
用户在 OpenClaw 网页输入「启动光伏余热仿真」
        │
        ▼
① SKILL.md 的 description/触发词命中 → Skill 被注入本轮上下文
        │
        ▼
② 第 1 步  exec:  node {baseDir}/scripts/run-simulation.cjs health
        │         → 服务未启动则先拉起 solarglyph-core/server.js
        ▼
③ 第 2 步  POST /v1/simulations            （下发任务，202 + job id）
        │   GET  /v1/simulations/{id}       （轮询 queued→…→succeeded）
        │   GET  /v1/simulations/{id}/result（取回结果）
        ▼
④ 第 4 步  把关键指标回报给用户；需要留档则 --report 写出 Markdown
```

Skill 的 `SKILL.md` 同时声明了 `command-dispatch: tool`，因此
`/solar-glyph-simulation` 可以**绕过模型直接确定性执行**，适合在无法配置模型的离线环境演示；
而自然语言触发（「启动光伏余热仿真」）走正常模型路径。

---

## 五、部署说明

### 5.1 仿真服务

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SOLARGLYPH_HOST` | `127.0.0.1` | 监听地址，**不要改成 0.0.0.0 暴露到公网** |
| `SOLARGLYPH_PORT` | `8787` | 监听端口 |
| `SOLARGLYPH_SIM_MS` | `3000` | 单次仿真耗时（用于演示可观测的轮询过程） |
| `SOLARGLYPH_URL` | `http://127.0.0.1:8787` | CLI 侧的服务地址 |
| `SOLARGLYPH_POLL_MS` | `1000` | CLI 轮询间隔 |
| `SOLARGLYPH_TIMEOUT_MS` | `120000` | CLI 轮询超时 |

生产化建议：把 `server.js` 放到进程管理器（systemd / NSSM / pm2）下，前置反向代理开启 HTTPS，
并把 §5.3 的余热参数换成项目实测数据。

### 5.2 上游 OpenClaw

按上游官方文档部署即可，本仓库未改动其部署方式：

```bash
cd upstream/openclaw-main
pnpm install --frozen-lockfile      # 依赖（Node 24.16+ / pnpm 12.3.4）
pnpm openclaw gateway               # 启动 Gateway（源码模式，运行期即时编译 TS）
pnpm openclaw --help                # 其他子命令
```

状态目录通过 `OPENCLAW_STATE_DIR` 隔离，便于演示时不污染既有环境。

### 5.3 Windows 平台的已知差异

上游仓库含 26 个指向仓库外的**符号链接**（`CLAUDE.md`、`.claude/skills`、一个 Swift fixture）。
Windows 上创建符号链接需要额外权限，本快照中这些链接被跳过，完整清单见
`work/reports/upstream-extract.json`。它们全部是 AI 助手指令/软链接转发文件，**不参与运行时代码路径**，
因此不影响 Gateway 启动与 Skill 加载。在 macOS/Linux 上按官方方式 `git clone` 可获得完整文件集。

---

## 六、实测证据

以下命令均在 Windows + Node v24.21.0 上实际执行并留存输出：

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| Skill 包完整性 | `node scripts/verify-skill.cjs` | 5/5 通过（frontmatter、字节一致、自包含、确定性、CLI 退出码） |
| 仿真引擎 | `node smoke.cjs` | 4 套预设全部产出合理量级结果 |
| HTTP 全链路 | `node e2e-http.cjs` | `202 → running(5%→25%→50%→70%→90%) → succeeded`，结果回取成功 |
| 错误处理 | 同上 | 非法容量返回 `422`，未知任务返回 `404` |

关键指标示例（`industrial-rooftop-5mw` 预设）：

```
PV 装机容量       5000 kWp
倾斜面年辐照量     1492.1 kWh/m²（相对水平面 +14.8%）
年发电量          499.5 万kWh（4995 MWh）
单位发电量        998.9 kWh/kWp·年
余热年回收热量     315.2 万kWh（11347 GJ）
ORC 年发电量      37.8 万kWh
年减排 CO₂        1776.4 t
```

详细日志与截图见 `docs/`。完整的实测记录、测试矩阵与**未通过项**见
[`docs/verification-evidence.md`](docs/verification-evidence.md)。

---

## 七、推送到你自己的 fork

本仓库已完成本地 git 初始化与分支划分，但**尚未推送到 GitHub**
（推送需要你自己的账号凭据）。按下面步骤建立可提交的线上仓库：

```bash
# 1) 在 GitHub 网页上 fork 官方仓库（无需本地操作）
#    https://github.com/openclaw/openclaw → Fork

# 2) 把 fork 添加为远端并推送
cd work/solarglyph-skill
git remote add origin https://github.com/<你的账号>/openclaw.git
git push -u origin main
git push -u origin feature/solar-glyph-simulation

# 3) 保留上游连接，便于评委核对血缘
git remote add upstream https://github.com/openclaw/openclaw.git
git fetch upstream
```

提交前建议核对：

```bash
git log --oneline --graph --all      # 分支与提交边界
git show --stat 18f5381              # Skill 的单独提交
```

> 本环境原生 TLS 受限，`git push` 无法在此执行；请在本机或 CI 环境推送。
> 若你的 fork 已有完整上游历史，用
> `git rebase --onto upstream/main 38ac45bc feature/solar-glyph-simulation`
> 把自研提交重放到真实上游历史之上，即可得到与官方仓库同源的干净分支。

---

## 八、许可与来源

- **上游 OpenClaw**：**MIT License**，Copyright (c) 2026 OpenClaw Foundation
  （GitHub API 将仓库许可证标记为 `NOASSERTION`，实际 `LICENSE` 文件为标准 MIT，以文件为准；
  全文见 `upstream/openclaw-main/LICENSE`）。上游仓库：
  <https://github.com/openclaw/openclaw>，快照提交 `ad1c9345f2cbbeee32fc006b963da86001bffbaa`
  （2026-09-16，`main`，版本 `2026.9.4`）。
- **本团队自研部分**（`work/solarglyph-skill/**`）：MIT，见 `LICENSE`。
- **算法来源**：光伏/辐照/储热/电气公式逆向自 SolarGlyph 工程站点打包产物，
  逐条对照见 `docs/solarglyph-algorithm-provenance.md`；余热回收模块为本团队原创。
- **上游快照获取方式**：本环境原生 TLS 受限，无法直接 `git clone`，改用
  `codeload` 源码快照 + Node 解包器（`tools/untar.mjs`）落地。复现方式见
  `docs/deployment.md`；快照已作为 vendored 目录提交（`38ac45bc`），字节与官方发布包一致。
