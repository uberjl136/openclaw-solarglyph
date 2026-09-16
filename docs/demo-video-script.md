# 演示视频脚本（约 5–7 分钟）

拍摄目标：让评委一眼看清三件事 ——
**① 原版 OpenClaw 做不到光伏仿真；② 加载自研 Skill 后能自动调度 SolarGlyph 跑完仿真；③ 仓库里原生代码与自研 Skill 界限清晰。**

录制前准备（每项都在终端里可见）：

```powershell
# 终端 A：仿真服务
cd work/solarglyph-skill; node solarglyph-core/server.js

# 终端 B：OpenClaw Gateway
cd upstream/openclaw-main; pnpm openclaw gateway     # http://127.0.0.1:18789/
```

---

## 第 1 幕：原版能力基线（约 60 秒）

**画面**：终端 + 浏览器。

1. 展示上游内置 Skill 清单，指出没有任何新能源能力：

   ```powershell
   cd upstream/openclaw-main
   pnpm openclaw skills list | Select-String "1password|weather|github|notion|skills"
   ```

   > 解说：这是官方 OpenClaw 的 50 余个内置 Skill —— 笔记、邮件、GitHub、天气、智能家居……
   > **没有任何一个能算光伏或余热**。它是通用智能体底座，不是行业应用。

2. 打开 `upstream/openclaw-main/skills` 目录，说明这些都是上游原生能力。

3. （可选，若已配置模型）在不加载本 Skill 的状态下问：
   「上海一个 5MW 厂区屋顶光伏一年发多少电？余热能回收多少？」
   > 解说：它只能给出定性的泛泛估计，拿不到可核对的工程数字，也无法调用任何仿真服务。

**本条要证明**：原版做不了这件事。

---

## 第 2 幕：加载自研 Skill（约 90 秒）

**画面**：文件管理器 + 编辑器 + 终端。

1. 打开自研 Skill 目录，逐项指明这是新增内容（非上游）：

   ```
   work/solarglyph-skill/
   ├── skills/solar-glyph-simulation/SKILL.md      ← Skill 定义（触发词、四步流程、HTTP 契约）
   ├── skills/solar-glyph-simulation/scripts/      ← 桥接 CLI + 触发词映射
   ├── solarglyph-core/                            ← 仿真引擎 + HTTP 服务（自研）
   └── docs/                                       ← 算法溯源、部署、报告
   ```

2. 高亮 `SKILL.md` 的关键部分：
   - frontmatter：`name` / `description` / `command-dispatch: tool` / `requires.bins: node`
   - 触发条件：「启动光伏余热仿真」
   - 四步执行流程：健康检查 → 下发任务 → 轮询 → 回报
   - HTTP 契约表：`POST /v1/simulations`、`GET /v1/simulations/{id}`、`.../result`

3. 安装并确认 OpenClaw 识别：

   ```powershell
   cd work/solarglyph-skill
   node scripts/install-skill.cjs
   node scripts/verify-skill.cjs        # 全绿
   cd ../../upstream/openclaw-main
   pnpm openclaw skills list | Select-String "solar"
   ```

   > 展示输出：`☀️ solar-glyph-simulation … openclaw-workspace`，状态 `✓ ready`，
   > 且 Skill 总数从 57 变为 58。

**本条要证明**：这是新增的、被框架正式加载的扩展，不是改上游源码。

---

## 第 3 幕：全自动跑完仿真（约 120 秒，核心）

**画面**：OpenClaw 网页控制台（`http://127.0.0.1:18789/`）+ 终端 A 的服务日志。

1. 在网页会话输入框敲入：

   ```
   启动光伏余热仿真
   ```

2. 观察并解说执行链（这是全片最关键的一段，建议放慢）：

   - Skill 被命中 → agent 调用 `exec` 工具；
   - 终端出现：`[solarglyph] submitted job <uuid>`；
   - 终端逐条滚出真实轮询进度：
     `loading-site-inputs 25%` → `transposing-irradiance 50%` →
     `solving-pv-and-waste-heat 70%` → `aggregating-results 90%` → `succeeded 100%`；
   - 网页里返回结果表：

     ```
     倾斜面年辐照量   1492.1 kWh/m²（相对水平面 +14.8%）
     年发电量         499.5 万kWh（4995 MWh）
     单位发电量       998.9 kWh/kWp·年
     余热年回收热量    315.2 万kWh（11347 GJ）
     ORC 年发电量     37.8 万kWh
     年减排 CO₂       1776.4 t
     ```

3. 终端里旁证 HTTP 是真实发生的（服务端任务队列）：

   ```powershell
   node work/solarglyph-skill/scripts/run-simulation.cjs presets
   curl.exe http://127.0.0.1:8787/v1/health
   ```

4. 追加一次「换参数」演示，证明是活的仿真而非硬编码：

   ```
   把容量的 5MW 换成 1MW，倾角改成 25 度，再跑一次
   ```

   或确定性入口：

   ```powershell
   node work/solarglyph-skill/scripts/trigger.cjs "西北高辐照 10MW"
   ```

5. 生成留档报告：

   ```powershell
   node work/solarglyph-skill/scripts/run-simulation.cjs run --preset industrial-rooftop-5mw --report demo.md
   ```

**本条要证明**：AI 下发 → 启动仿真 → 轮询状态 → 拿回结果，全自动闭环。

---

## 第 4 幕：仓库与文档（约 90 秒）

**画面**：git 客户端 / 终端。

1. 展示分支与提交边界：

   ```powershell
   cd work/solarglyph-skill
   git log --oneline --graph --all
   git show --stat <SKILL 单独提交的 SHA>
   ```

   > 解说：Skill 与仿真服务是**单独的分支、单独的提交**，与上游快照完全分离。

2. 展示 `README.md` 的「仓库结构」一节：上游 `upstream/` vs 自研 `work/solarglyph-skill/`。

3. 展示 `docs/solarglyph-algorithm-provenance.md`：
   逐条公式对照表 + 站点行号 + 哪些是自研扩展（余热回收模块）。

4. 展示代码统计，量化自研规模：

   ```powershell
   (Get-ChildItem work\solarglyph-skill -Recurse -File -Include *.js,*.cjs,*.md | Measure-Object -Property Length -Sum).Sum / 1KB
   ```

**本条要证明**：代码归属清楚、可核查、可复现。

---

## 第 5 幕：收尾（约 30 秒）

1. 回到仿真结果，说明工程价值：余热回收让同一个项目多出
   **37.8 万 kWh/年 ORC 发电 + 267.9 万 kWh/年 可用供热**，年减排 1776 吨 CO₂。
2. 说明边界与诚实性：辐照数据为区域年值 + 几何近似，不是 8760 气象逐时模拟；
   结果用于方案比选，署名算法来源与自研扩展范围。

---

## 录制检查清单

- [ ] 终端字号放大到 16–18pt，确保录屏可读
- [ ] 三条命令提前在历史里，避免现场手打
- [ ] 第 3 幕开始时先清屏，保证「提交 → 轮询 → 结果」连续可见
- [ ] 全程不要出现真实 API key、令牌或个人信息
- [ ] 结尾定格在结果表与 `verify-skill.cjs` 全绿画面
