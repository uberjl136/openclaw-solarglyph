# 部署与运行说明

本文覆盖三部分：**仿真服务**、**OpenClaw 上游**、**Skill 安装**，以及本环境特有的注意事项。

---

## 一、环境要求

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | `>=24.16.0 <25` 或 `>=26.1.0` | 与上游 `package.json` 的 `engines` 一致；本环境 v24.21.0 |
| pnpm | `12.3.4` | 上游 `packageManager` 锁定 |
| git | 较新版本即可 | 仅提交/推送需要 |
| 操作系统 | Windows / macOS / Linux | 仿真服务与 Skill 均跨平台 |

仿真服务**零第三方依赖**（仅 `node:http` + `node:zlib` 等内置模块），不需要 `pnpm install` 即可单独运行。

---

## 二、仿真服务（SolarGlyph）

```bash
cd work/solarglyph-skill
node solarglyph-core/server.js                # 默认 127.0.0.1:8787
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SOLARGLYPH_HOST` | `127.0.0.1` | 监听地址 |
| `SOLARGLYPH_PORT` | `8787` | 监听端口 |
| `SOLARGLYPH_SIM_MS` | `3000` | 单次仿真耗时（便于观察轮询过程） |

自检：

```bash
node scripts/verify-skill.cjs     # Skill 包 + 引擎 + 触发器
node smoke.cjs                    # 4 套预设场景
node e2e-http.cjs                 # HTTP 全链路（需服务在线）
```

### 生产化建议

1. 用进程管理器托管（systemd / NSSM / pm2），不要挂在交互式终端上。
2. 前置反向代理并启用 HTTPS；服务本身**只监听回环地址**，不要直接暴露公网。
3. 用 `authentication` 中间件保护 `/v1/*`（本仓库为演示保留了无鉴权形态）。
4. 把 `presets.js` 中的余热参数替换为项目实测数据。

---

## 三、OpenClaw 上游

```bash
cd upstream/openclaw-main
pnpm install --frozen-lockfile
pnpm openclaw gateway            # 启动 Gateway
```

要点：

- 源码检出目录下 OpenClaw 走 tsx 运行期编译；首次运行会自动构建 `dist`（约 1 分钟）。
- 状态目录用 `OPENCLAW_STATE_DIR` 隔离，避免污染既有环境。
- 配置文件为 `$OPENCLAW_STATE_DIR/openclaw.json`，首次启动需要 `gateway.mode`：

```json5
{
  gateway: { mode: "local" },
  // 自备模型（示例：本地 Ollama）
  models: {
    providers: {
      ollama: { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama", api: "openai-completions" }
    }
  },
  agents: { defaults: { model: "ollama/qwen2.5:1.5b-instruct" } }
}
```

- `pnpm openclaw doctor` 可诊断配置与依赖问题。

### 本环境踩过的坑（供复现参考）

1. **原生 TLS 被限制**：本环境中 `curl`、`git clone` 等走 Windows Schannel 的工具会报
   `SEC_E_NO_CREDENTIALS`，但 Node.js 的 TLS 正常。因此上游快照用
   `tools/dl.mjs`（Node 下载）+ `tools/untar.mjs`（Node 解包）落地，而不是 `git clone`。
2. **NTFS 保留文件名**：上游含 `CLAUDE.md` 等文件名，`tar.exe`/`Expand-Archive` 无法创建；
   Node 解包器按需跳过并记录 26 个条目（全部为指向仓库外的符号链接）。
   完整清单见 `work/reports/upstream-extract.json`。
3. **子进程管道 stdio 受限**：pnpm/npm 的 postinstall 若使用管道捕获输出会 `EPERM`；
   用 `--foreground-scripts`（继承 stdio）可绕过。esbuild 的 postinstall 自检在本环境失败，
   用 `pnpm install --ignore-scripts` 完成安装即可，运行期首次启动会自动构建。
4. **HOME 需重定向**：默认 `~/.openclaw` 位于用户目录，本环境不可写；
   用 `OPENCLAW_STATE_DIR` + `HOME`/`USERPROFILE` 指向工作区内目录。

---

## 四、安装 Skill

```bash
cd work/solarglyph-skill
node scripts/install-skill.cjs
```

默认安装到 `~/.openclaw/workspace/skills/solar-glyph-simulation`；
可用环境变量覆盖：

```bash
OPENCLAW_WORKSPACE=/path/to/workspace node scripts/install-skill.cjs
```

安装后确认 OpenClaw 已识别：

```bash
cd ../../upstream/openclaw-main
pnpm openclaw skills list          # 应出现 ☀️ solar-glyph-simulation  ✓ ready
```

---

## 五、上游快照的复现方式

本仓库的 `upstream/openclaw-main` 是官方 `main` 分支在提交
`ad1c9345f2cbbeee32fc006b963da86001bffbaa`（2026-09-16）的快照。复现步骤：

```bash
# 1) 下载源码快照（Node 版下载器，绕过本机原生 TLS 限制）
node tools/dl.mjs \
  https://codeload.github.com/openclaw/openclaw/tar.gz/refs/heads/main \
  tools/_cache/openclaw-main.tar.gz

# 2) 解包（Node 版 tar 解包器，跳过 NTFS 保留名并输出报告）
node tools/untar.mjs tools/_cache/openclaw-main.tar.gz upstream/openclaw-main \
  work/reports/upstream-extract.json
```

在 TLS 正常的环境里，直接用官方方式即可获得完整历史：

```bash
git clone --depth 1 https://github.com/openclaw/openclaw.git
```
