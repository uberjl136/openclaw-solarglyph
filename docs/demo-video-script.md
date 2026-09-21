# 演示视频脚本（3—5 分钟，符合官方硬性要求）

官方要求（附件 1·四·4）：**MP4，时长 3—5 分钟，≤300 MB**；
视频须清晰展示**作品核心功能、操作流程、实现效果，以及开源项目改进或开放成果**。

同时受公平性约束（规则三·九）：**全片不得出现学校名称、学校 LOGO、指导教师信息**。

下面按 4 分钟设计（留 1 分钟余量），总计约 4:00。

---

## 录制前准备

```powershell
# 终端 A：仿真服务
cd work/solarglyph-skill; node solarglyph-core/server.js

# 终端 B：OpenClaw Gateway
cd upstream/openclaw-main; pnpm openclaw gateway     # 控制台 http://127.0.0.1:18789/
```

前置检查：

- [ ] 终端字号 16—18pt，录屏可读
- [ ] 待用的命令提前进历史，避免现场手打
- [ ] 隐藏桌面/任务栏/浏览器书签中的学校相关信息
- [ ] 关闭可能弹出通知的软件

---

## 0:00—0:30 ｜ 开场：问题是什么

**画面**：PPT 或字幕卡（1 页）+ 终端。

**旁白**：

> 工业厂区屋顶光伏项目，方案阶段要回答两个问题：**一年能发多少电？余热能回收多少？**
> 常规做法是人工翻气象数据、套 Excel 公式，慢且不可复现。
> 通用 AI 智能体虽然会调用工具，却**不具备任何光伏与余热工程计算能力**。
> 我们基于开源智能体框架 OpenClaw，做了一个新能源仿真 Skill，让一句自然语言指令完成整套仿真。

**画面操作**：展示上游内置能力清单，指出没有新能源相关项。

```powershell
cd upstream/openclaw-main
pnpm openclaw skills list | Select-String "1password|weather|github|notion"
```

> 这些都是 OpenClaw 原生的通用能力——笔记、邮件、GitHub、天气。**没有任何一个能算光伏或余热。**

---

## 0:30—1:20 ｜ 原版做不到，我们加了什么

**画面**：文件管理器展示自研目录 + 编辑器打开 `SKILL.md`。

**旁白**：

> 我们没有改动 OpenClaw 的底层源码。上游代码原样保留在 `upstream` 目录，
> 我们的扩展全部放在独立的 `work/solarglyph-skill` 仓库里。

**画面操作**：逐项指认

```
skills/solar-glyph-simulation/SKILL.md     ← Skill 定义：触发词 + 四步流程 + HTTP 契约
solarglyph-core/engine.js                  ← 光伏/余热工程模型
solarglyph-core/server.js                  ← 仿真服务（HTTP 任务队列）
docs/solarglyph-algorithm-provenance.md    ← 20 条公式逐条溯源，标注自研边界
```

**旁白要点**：

> 工程算法来自 SolarGlyph 工程平台的前端打包产物。我们先确认了一件事：
> **该站点没有仿真接口**——服务端只有登录和地理编码，所有计算都在浏览器里。
> 所以我们把算法固化成了一套真实可调用的 HTTP 仿真服务，再由 Skill 驱动它。
> **余热回收模块是我们自己加的**，原站点完全没有这块。

---

## 1:20—2:40 ｜ 核心演示：全自动跑完一次仿真（重点段）

**画面**：OpenClaw 网页控制台 + 终端 A（左右并排或快速切换）。

**操作 1**：在网页输入框输入

```
启动光伏余热仿真
```

**旁白（跟随进度解说）**：

> 我输入的是自然语言，模型命中 Skill 后调用 exec 工具执行仿真脚本。
> 请看终端：任务已经提交，服务返回任务号；接着是**真实的轮询过程**——
> 加载站点输入、倾斜面辐照换算、求解光伏与余热、汇总结果。

**画面**：终端逐条滚出

```
[solarglyph] trigger matched "启动光伏余热仿真" -> preset industrial-rooftop-5mw
[solarglyph] submitted job <uuid>
[solarglyph] loading-site-inputs 25%
[solarglyph] transposing-irradiance 50%
[solarglyph] solving-pv-and-waste-heat 70%
[solarglyph] aggregating-results 90%
[solarglyph] succeeded 100%
```

**画面**：结果表

```
倾斜面年辐照量   1492.1 kWh/m²（相对水平面 +14.8%）
年发电量         499.5 万kWh（4995 MWh）
单位发电量       998.9 kWh/kWp·年
余热年回收热量    315.2 万kWh（11347 GJ）
ORC 年发电量     37.8 万kWh
年减排 CO₂       1776.4 t
```

**操作 2**：再跑一次换参数，证明是活的计算而非写死。

```
把容量从 5MW 换成 1MW，倾角改成 25 度，再跑一次
```

**旁白**：数字随参数变化，说明背后是真实求解；每次仿真都是独立的异步任务，可查历史。

**操作 3**：展示服务端任务历史（可核验证据）。

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/simulations?limit=10 |
  Select-Object -ExpandProperty jobs | Format-Table createdAt,status,presetId
```

---

## 2:40—3:30 ｜ 开源改进与开放成果

**画面**：终端跑校验脚本 + git 历史。

**旁白**：

> 相对上游 OpenClaw，我们的实质改进有三处，都可独立核验：
> 第一，新增垂直场景 Skill；第二，自研了配套的仿真服务；第三，打通了完整自动化闭环。
> 同时我们提供了确定性入口——不依赖模型也能跑，便于复现。

**画面操作**：

```powershell
cd work/solarglyph-skill
node scripts/verify-skill.cjs        # 7 项校验全绿
git log --oneline --graph --all      # 分支与提交边界
git show --stat 18f5381              # Skill 的单独提交
```

**旁白**：

> Skill 与仿真服务是**单独的分支、单独的提交**，与上游快照边界清晰。
> 上游快照是官方发布包的字节忠实副本，我们**没有改过任何一行上游代码**。

**画面**：`docs/solarglyph-algorithm-provenance.md` 的对照表（滚动展示）

> 这份文档把每一个公式对照到原站点的具体位置，并明确标出哪些是复现、哪些是我们的自研扩展。
> 开放成果包括：Skill 包、仿真服务源码、算法溯源文档、实测证据与部署说明。

---

## 3:30—4:00 ｜ 收尾：价值与边界

**画面**：结果表定格 + 结束字幕卡。

**旁白**：

> 以这个 5 兆瓦项目为例：年发电 499.5 万度，余热年回收 315.2 万度，
> 其中 ORC 发电 37.8 万度，年减排二氧化碳 1776 吨。
> 一个原本要人工核算数天的方案评估，现在一句指令就能拿到可复现的结果。
>
> 我们也如实说明边界：辐照数据采用区域年值加几何近似，不是 8760 小时逐时气象模拟；
> 结果用于方案比选，不替代正式的可行性研究。这些限制都写在技术报告里。

---

## 录制检查清单

- [ ] 成片时长落在 **3:00—5:00** 之间（建议 4:00 左右）
- [ ] 导出 **MP4**，体积 **≤ 300 MB**
- [ ] 全片无**学校名称、LOGO、指导教师信息**
- [ ] 无 API 密钥、账号密码等凭据出现在画面里
- [ ] 第 3 段（核心演示）连续可见，不要剪断轮询过程
- [ ] 结尾定格在结果表 + `verify-skill.cjs` 全绿画面
