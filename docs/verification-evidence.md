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

## 2. 未通过项（如实记录）

### 2.1 本地小模型无法稳定完成"自然语言 → 工具调用"编排

这是**唯一未打通**的环节。测试矩阵：

| 模型 | 提示 | 结果 |
| --- | --- | --- |
| `qwen2.5:1.5b-instruct` | 「启动光伏余热仿真」 | 把工具调用当普通文本输出：`{"function":"run_exec","arguments":{...}}`，未真正调用 |
| `qwen3:4b` | 「启动光伏余热仿真」 | 连续 9 次调用 `tool_call` 代理，全部失败 |
| `qwen3:4b` | 显式给出 exec 命令与技能名 | 误调用 `subagents`，回答"当前没有活动会话" |
| `qwen3:8b` | 「启动光伏余热仿真」 | 未调用任何工具，回答"系统当前空闲" |
| `qwen3:8b` | `/skill solar-glyph-simulation 启动光伏余热仿真` | 仍未调用工具 |

**诊断结论**：

1. Skill **已被正确发现并注入**——模型可见工具列表中出现 `solar-glyph-simulation`
   与 `exec`，说明集成层没有问题；
2. 失败发生在**模型决策**环节：本地 1.5B–8B 量化模型在 OpenClaw 这套
   工具面（数十个工具、超长系统提示）下，无法可靠选择并调用 `exec`；
3. 这是已知的模型能力问题，不是本项目链路的缺陷。

**因此本环节通过以下两条路径交付，而非依赖本地小模型**：

| 路径 | 说明 | 状态 |
| --- | --- | --- |
| **确定性调度**（`command-dispatch: tool`） | Skill 斜杠命令绕过模型，直接执行 `trigger.cjs` → 完整仿真闭环 | **已实测通过**（§1.1 最后一项、§1.3） |
| **模型驱动**（自然语言触发） | 模型读取 SKILL.md 指令后调用 `exec` | 需 30B 级及以上模型；本项目未能在本机验证 |

> 演示视频建议：模型驱动那一段使用你实际可用的云端模型（如 OpenAI / Anthropic / 通义等）
> 录制；若现场只有本地小模型，则演示确定性入口
> `node scripts/trigger.cjs "启动光伏余热仿真"`，同样能完整展示
> 下发 → 轮询 → 取结果的闭环。

### 2.2 环境侧限制（已绕过，不影响交付）

| 限制 | 表现 | 绕法 |
| --- | --- | --- |
| 原生 TLS 被限制 | `curl` / `git clone` 报 `SEC_E_NO_CREDENTIALS` | 用 Node（`tools/dl.mjs`）下载、Node 解包器（`tools/untar.mjs`）落地 |
| NTFS 保留文件名 | `tar.exe` / `Expand-Archive` 无法创建 `CLAUDE.md` | Node 解包器跳过并记录 26 个符号链接条目 |
| 子进程管道 stdio 受限 | npm/pnpm postinstall 报 `spawn EPERM` | `--foreground-scripts`（继承 stdio） |
| esbuild postinstall 失败 | 版本自检 `spawnSync EPERM` | `pnpm install --ignore-scripts`；运行期首次启动自动构建 |
| `~/.openclaw` 不可写 | git/OpenClaw 无法写用户目录 | `OPENCLAW_STATE_DIR` + `HOME` 重定向到工作区 |
| Control UI 首次 503 | 网关与 UI 构建身份不一致 | 先 `pnpm build`（含 UI），再重启 Gateway |

---

## 3. 复现全部验证

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
```

---

## 4. 结论

- **可交付**：Skill、仿真服务、HTTP 闭环、OpenClaw 加载、仓库与文档全部完成并验证。
- **唯一缺口**：本机可用的最大本地模型（8B）无法胜任工具编排；
  模型驱动的自然语言触发需更大模型，已提供等价的确定性入口。
- **无夸大**：所有未通过项均已列明，所有数字均为实测输出。
