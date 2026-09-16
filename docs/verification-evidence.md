# 实测证据与已知限制

本文件记录本项目在**本机实际执行**过的验证命令、输出与结论，包括未能通过的部分。
所有数字均为真实运行结果，可直接复现。

- 环境：Windows，Node.js v24.21.0，pnpm 12.3.4，OpenClaw 2026.9.4
- 上游快照：`ad1c9345f2cbbeee32fc006b963da86001bffbaa`（`main`，2026-09-16）
- 本地模型：Ollama 0.34.1（`qwen2.5:1.5b-instruct`、`qwen3:4b`、`qwen3:8b`）

---

## 1. 已完成并验证

### 1.1 Skill 包完整性 —— `node scripts/verify-skill.cjs`

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

最后一项是**真实端到端**：`trigger.cjs` 命中触发词 → 映射到预设 → 通过 HTTP 提交任务 →
轮询状态 → 取回结果，退出码 0。

### 1.2 仿真引擎 —— `node smoke.cjs`

| 预设 | 装机 | 年发电量 | 单位发电量 | 余热年回收 | CO₂ 减排 |
| --- | --- | --- | --- | --- | --- |
| `industrial-rooftop-5mw` | 5000 kWp | 499.5 万kWh | 998.9 kWh/kWp | 315.2 万kWh | 1776.4 t |
| `industrial-rooftop-1mw` | 1000 kWp | 109.2 万kWh | 1091.9 kWh/kWp | 117.6 万kWh | 621.9 t |
| `high-irradiance-10mw` | 10000 kWp | 1569.4 万kWh | 1569.4 kWh/kWp | 217.2 万kWh | 1287.5 t |
| `pv-thermal-storage-cooling` | 1200 kWp | 150.0 万kWh | 1250.0 kWh/kWp | 43.1 万kWh | 212.8 t |

第 4 套复现了 SolarGlyph 工程页的结论：**冷量覆盖率 100.0%**。

### 1.3 HTTP 全链路 —— `node e2e-http.cjs`

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

### 1.4 OpenClaw 加载 Skill —— `pnpm openclaw skills list`

```
Skills (22/58 ready)
| ✓ ready | ☀️ solar-glyph-simulation | 光伏-新能源仿真… | openclaw-workspace |
```

安装前为 `21/57`，安装后为 `22/58`，来源 `openclaw-workspace`，状态 `✓ ready`。

### 1.5 上游原版能力基线（演示视频第一幕的依据）

同一份 `skills list` 输出显示，上游 57 个内置能力全部是通用任务
（笔记、邮件、GitHub、天气、智能家居、调试等），**没有任何一项涉及光伏、辐照、
余热、储热或电力工程计算**。

### 1.6 OpenClaw 运行态

| 服务 | 地址 | 状态 |
| --- | --- | --- |
| OpenClaw Gateway / 控制台 | `http://127.0.0.1:18789/` | **HTTP 200**，控制台可用 |
| SolarGlyph 仿真服务 | `http://127.0.0.1:8787/v1/health` | `status=ok`，v1.0.0 |
| Ollama 模型服务 | `http://127.0.0.1:11434` | 3 个模型可用 |

Gateway 日志确认模型接入成功：

```
[gateway] agent model: ollama/qwen3:4b (thinking=off, fast=off)
[gateway] http server listening (17 plugins: …)
[gateway] ready
```

Agent 回合确实路由到真实模型：

```json
"executionTrace": { "winnerProvider": "ollama", "winnerModel": "qwen3:8b",
                    "attempts": [{ "result": "success" }], "fallbackUsed": false }
```

### 1.7 代码归属量化 —— `node scripts/stats.cjs`

```
our extension      : 24 files, 5383 lines, 208.7 KB
upstream snapshot  : 41468 files, 12260343 lines, 464224.2 KB
our share of bytes : 0.0% (0.045%)
```

---

## 2. 模型驱动路径（自然语言 → 工具调用）

### 2.1 结论：可以打通，但需要"精简配置"

**决定性证据**来自仿真服务自身的任务历史（服务端记录，非模型自述）。
下列任务全部由 **8B 本地模型的 agent 回合**提交：

| 本地时间 | job id | 对应动作 |
| --- | --- | --- |
| 16:18:06 | `3daec0ca` | 8B + 显式英文指令，精简配置 |
| 18:00:29 | `47d19f56` | 8B + 自然语言触发 |
| 18:03:31 | `68bd5599` | 模型驱动复测 |
| 18:05:41 | `fd49a3d4` | 模型驱动复测 |
| 18:07:10 | `09ad500c` | 模型驱动复测 |
| 18:10:35 | `194367d5` | 模型驱动复测 |
| 18:11:22 | `a63f669b` | 模型驱动复测 |

查询方式（可复核）：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/simulations?limit=30 | Select-Object -ExpandProperty jobs
```

模型回合的原始记录中 `successfulToolNames: ["exec"]`，即 `exec` 调用成功。

### 2.2 让模型驱动可用的配置（关键）

默认配置下 1.5B–8B 本地模型**全部失败**。经排查，原因不是集成，而是三项提示负担：

| 问题 | 现象 | 修复 |
| --- | --- | --- |
| 工具 schema 过大 | 系统提示里 `tools.schemaChars = 66715`（约 66 KB），模型注意力被淹没 | `tools.allow: ["read","exec"]` → 降到 **2.6 KB** |
| 工作区引导文件带偏 | 模型跑去回答 `SOUL.md`/`IDENTITY.md`/`USER.md` 的初始化问题 | `agents.defaults.skipBootstrap: true` + `contextInjection: "never"` |
| Tool Search 代理层 | 模型只调用 `tool_call` 代理，9 次全部失败 | `tools.toolSearch: false`，让 `exec` 直接可见 |

采用上述精简配置后，8B 模型成功调用 `exec` 并产出真实仿真结果
（年发电 499.5 万 kWh、余热回收 315.2 万 kWh、CO₂ 减排 1776.4 t）。

复现命令：

```bash
node scripts/test-model-driven.cjs --model ollama/qwen3:8b
```

脚本会自动生成隔离状态目录、写入精简配置、安装 Skill，然后跑一个 agent 回合。

### 2.3 仍存在的限制（如实说明）

- **可靠性依赖提示清晰度**：同一配置下，指令越明确成功率越高。多次复测中模型**都提交了任务**，
  但最终自然语言总结偶尔会漂移（例如回答"没有已批准的可执行文件"），属于 8B 模型在长上下文中
  的表达不稳，不影响仿真是否执行。
- **纯触发词（仅「启动光伏余热仿真」）不足以稳定触发**：需要指令中带出技能名或执行意图。
  这是小模型的指令跟随能力上限。
- **建议**：正式演示用 30B 级以上或云端模型，自然语言触发会稳定得多；
  若只有本地小模型，用 `trigger.cjs` 确定性入口最可靠。

---

## 3. 环境侧限制（已绕过，不影响交付）

| 限制 | 表现 | 绕法 |
| --- | --- | --- |
| 原生 TLS 被限制 | `curl` / `git clone` 报 `SEC_E_NO_CREDENTIALS` | 用 Node（`tools/dl.mjs`）下载、Node 解包器（`tools/untar.mjs`）落地 |
| NTFS 保留文件名 | `tar.exe` / `Expand-Archive` 无法创建 `CLAUDE.md` | Node 解包器跳过并记录 26 个符号链接条目 |
| 子进程管道 stdio 受限 | npm/pnpm postinstall 报 `spawn EPERM` | `--foreground-scripts`（继承 stdio） |
| esbuild postinstall 失败 | 版本自检 `spawnSync EPERM` | `pnpm install --ignore-scripts`；运行期首次启动自动构建 |
| `~/.openclaw` 不可写 | git/OpenClaw 无法写用户目录 | `OPENCLAW_STATE_DIR` + `HOME` 重定向到工作区 |
| Control UI 首次 503 | 网关与 UI 构建身份不一致 | 先 `pnpm build`（含 UI），再重启 Gateway |
| 路径含空格 | `spawn pnpm.cmd` + `shell:true` 把 `--message-file` 参数拆开 | 直接调用 `scripts/run-node.mjs`，不经 shell |

---

## 4. 复现全部验证

```powershell
# 0) 启动仿真服务（另开终端）
cd work/solarglyph-skill
node solarglyph-core/server.js

# 1) 三项自检
node scripts/verify-skill.cjs
node smoke.cjs
node e2e-http.cjs

# 2) 安装 Skill 到 OpenClaw
node scripts/install-skill.cjs

# 3) 确认 OpenClaw 已加载（另开终端）
cd ../../upstream/openclaw-main
pnpm openclaw skills list | Select-String "solar"

# 4) 模型驱动路径（需 Ollama 与一个 4B 以上模型）
cd ../../work/solarglyph-skill
node scripts/test-model-driven.cjs --model ollama/qwen3:8b

# 5) 核对服务端任务历史
Invoke-RestMethod http://127.0.0.1:8787/v1/simulations?limit=30 |
  Select-Object -ExpandProperty jobs | Format-Table createdAt,status,presetId
```

---

## 5. 结论

- **确定性入口**：完全闭环，`trigger.cjs` 端到端实测通过。
- **模型驱动入口**：在精简配置下闭环，服务端任务历史可作证；可靠性随模型规模与指令清晰度变化。
- **无夸大**：所有数字均为实测输出，所有限制均已列明。
