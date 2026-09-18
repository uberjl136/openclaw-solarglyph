# 演示视频·录像执行手册（照着做即可）

目标：录一条 **3—5 分钟（建议 4 分钟）** 的 MP4，≤300 MB，
清晰展示**核心功能、操作流程、实现效果、开源改进与开放成果**。

铁律：**全片不得出现学校名称、学校 LOGO、指导教师信息**，也不得出现任何账号密码/密钥。

---

## 第一步：录制前的准备（约 10 分钟）

### 1.1 启动三个服务

打开**三个 PowerShell 窗口**，分别执行（顺序不要乱）：

**终端 A —— 仿真服务**

```powershell
cd "$env:USERPROFILE\Desktop\DS Harness\work\solarglyph-skill"
node solarglyph-core/server.js
```

看到 `listening on http://127.0.0.1:8787` 即成功。

**终端 B —— 仓库目录（后面跑命令用）**

```powershell
cd "$env:USERPROFILE\Desktop\DS Harness\work\solarglyph-skill"
# 本次录制需要的环境变量，先设好
$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\Desktop\DS Harness\work\openclaw-state"
$env:PATH = "$env:USERPROFILE\Desktop\DS Harness\tools\npm-global;$env:PATH"
```

> **重要**：终端 A 必须**保持开着**，它是仿真服务。关掉它，镜头 3 会报
> `The SolarGlyph simulation service is not reachable`。这个报错本身很清晰，
> 但录进视频里就不好看了，所以开录前务必确认它在跑。

**终端 C —— OpenClaw Gateway（可选，只在需要展示网页控制台时启动）**

```powershell
cd "$env:USERPROFILE\Desktop\DS Harness\upstream\openclaw-main"
$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\Desktop\DS Harness\work\openclaw-state"
pnpm openclaw gateway
```

看到 `[gateway] ready` 后，浏览器打开 <http://127.0.0.1:18789/>

> 提示：Gateway 首次启动可能要构建 1—2 分钟。**建议提前启动好**，别在录制时等。

### 1.2 清屏与排错检查

在终端 B 里先跑一遍下面这些命令，确认都能出结果，**再开录**：

```powershell
# 自检（应全绿）
node scripts/verify-skill.cjs

# 四套场景（应出数字）
node smoke.cjs

# 确定性入口（应跑完并出结果表）
node scripts/trigger.cjs "启动光伏余热仿真"
```

### 1.3 隐藏不该出现的东西

| 检查项 | 怎么改 |
| --- | --- |
| 桌面图标/文件名含学校信息 | 新建一个空文件夹放录屏窗口，或换壁纸 |
| 浏览器书签栏含学校名称 | `Ctrl+Shift+B` 隐藏书签栏 |
| 终端标题含用户名 | 无所谓（不是学校信息）；但不要显示含中文姓名的路径 |
| 通知弹窗 | 开"专注助手"；退出微信/QQ/钉钉 |
| 浏览器其他标签页 | 只留需要的；建议用**无痕窗口** |
| 分辨率 | 1920×1080，缩放 100%（字号才清晰） |
| 终端字号 | 调到 **16—18pt**，全屏后确保最后一排字看得清 |

---

## 第二步：怎么录（工具二选一）

### 方案 A：系统自带（不用装东西，推荐先用这个）

1. 按 **Win + G** 打开 Xbox Game Bar
2. 点"捕获"面板里的 **开始录制**（或按 **Win + Alt + R** 直接开录）
3. 录完再按 **Win + Alt + R** 停止
4. 文件位置：`C:\Users\<你>\Videos\Captures\`

局限：默认录**当前活动窗口**，切窗口会断。因此**尽量在一个窗口内完成**，或用方案 B。

### 方案 B：OBS Studio（免费开源，可精确控制，推荐正式录制）

1. 下载安装：<https://obsproject.com/>
2. 添加来源：`+` → **显示器采集**（录全屏）或 **窗口采集**（只录一个窗口，更安全）
3. 设置 → 输出 → 输出模式改 **高级** → 录像：
   - 编码器：`x264` 或硬件编码（NVENC/QSV）
   - 码率：**6000—8000 Kbps**（1080p 足够，4 分钟约 200—240 MB，**不超 300 MB**）
   - 格式：**MP4**
4. 设置 → 视频：**1920×1080**，**30 fps**
5. 设置 → 音频：麦克风选你的设备，**建议同时录旁白**（后期不用再配）

> 想省事：用 OBS 录**屏幕 + 麦克风**，一次成片。

---

## 第三步：逐镜头录制（配旁白稿，可直接念）

> 语速按每分钟约 240 字设计，全片旁白约 1000 字 ≈ 4 分钟。

### 镜头 1 ｜ 0:00—0:30 ｜ 问题是什么

**画面**：终端 B 全屏。这一段分两步，**先录干净基线，再录加载后**，对比最直观。

**第 1 步——先卸载我们的 Skill，露出上游原版基线**

```powershell
cd "$env:USERPROFILE\Desktop\DS Harness\work\solarglyph-skill"
node scripts/uninstall-skill.cjs
```

**第 2 步——列出上游能力**

```powershell
$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\Desktop\DS Harness\work\openclaw-state"
$env:PATH = "$env:USERPROFILE\Desktop\DS Harness\tools\npm-global;$env:PATH"
cd "$env:USERPROFILE\Desktop\DS Harness\upstream\openclaw-main"
pnpm openclaw skills list | Select-String "Skills \(|1password|weather|github|notion|summarize"
```

画面应显示 **`Skills (21/57 ready)`**，且**看不到** `solar-glyph-simulation` —— 这就是上游原版。

> **注意**：`OPENCLAW_STATE_DIR` 必须设对，否则读到的是默认目录，卸载/复装都作用不到同一处。
> 录完镜头 1 记得复装（见镜头 2 末尾），否则后面镜头 4 会看不到我们的 Skill。

**旁白**：

> 工业厂区屋顶光伏项目，方案阶段要回答两个问题：一年能发多少电？余热还能回收多少？
> 目前靠人工查气象数据、套 Excel 公式，慢，而且没法复现。
> 通用 AI 智能体虽然能调用工具，却不具备光伏与余热的工程计算能力。
> 这是**未做任何扩展**的原版 OpenClaw，自带五十七个能力，
> **没有任何一个能算光伏或余热**。这就是我们要解决的问题。

**注意**：画面里只出现技能名，不要滚动到含个人信息的路径。

---

### 镜头 2 ｜ 0:30—1:20 ｜ 我们加了什么

**此时把 Skill 装回来**（镜头 1 里卸载过，这一步既是复装，也是"加载 Skill"的画面）：

```powershell
cd "$env:USERPROFILE\Desktop\DS Harness\work\solarglyph-skill"
node scripts/install-skill.cjs
cd "$env:USERPROFILE\Desktop\DS Harness\upstream\openclaw-main"
pnpm openclaw skills list | Select-String "solar|Skills \("
```

画面应显示 **`Skills (22/58 ready)`**，多出的那一行正是我们的 Skill。

**旁白（接着镜头 1）**：

> 现在把本次作品新增的 Skill 装进去。技能数从五十七变成五十八。
> 需要说明的是，我们**没有改动 OpenClaw 的底层源码**——
> 上游代码原样保留，我们的扩展以新增的方式接入框架。

**然后指认自研内容**（文件管理器 / VS Code 打开 `work\solarglyph-skill`）：

**旁白**：

> 这是 Skill 定义文件，写清了触发条件、四步执行流程和 HTTP 接口契约。
> 这是自研的仿真引擎，负责光伏发电与余热回收的工程计算。
> 这是配套的 HTTP 服务，提供任务提交、状态轮询和结果查询。
> 这份是算法溯源文档，二十条公式逐条对照来源，并标出哪些是复现、哪些是我们自己做的。
> 原工程平台只是纯前端应用，服务端没有仿真接口，所以我们把算法固化成了可调用的服务。

**操作提示**：打开 `docs/solarglyph-algorithm-provenance.md` 滚动展示对照表 3—5 秒。

---

### 镜头 3 ｜ 1:20—2:45 ｜ 核心演示（最重要，别剪断）

**画面**：终端 B 全屏（与终端 A 并排更好）。

**操作 1**：输入并回车

```powershell
node scripts/trigger.cjs "启动光伏余热仿真"
```

**此时会依次滚出**（旁白跟着念进度）：

```
[solarglyph] trigger matched "启动光伏余热仿真" -> preset industrial-rooftop-5mw
[solarglyph] submitted job <任务号>
[solarglyph] loading-site-inputs 25%
[solarglyph] transposing-irradiance 50%
[solarglyph] solving-pv-and-waste-heat 70%
[solarglyph] aggregating-results 90%
[solarglyph] succeeded 100%
```

**旁白**：

> 我输入的是中文指令。系统识别出这是光伏余热仿真，
> 自动选用五兆瓦工业厂区场景，提交任务并拿到任务号。
> 接着是真实的轮询过程：加载输入、辐照换算、求解光伏与余热、汇总结果。
> 整个过程走真实的 HTTP 接口，不是本地硬编码。

**操作 2**：结果表出现后，**停留 5 秒不要动**，让评委看清：

```
年发电量         499.5 万kWh（4995 MWh）
单位发电量       998.9 kWh/kWp·年
余热年回收热量    315.2 万kWh（11347 GJ）
ORC 年发电量     37.8 万kWh
年减排 CO₂       1776.4 t
```

**旁白**：

> 结果出来了。五兆瓦装机，年发电四百九十九万度，
> 余热年回收三百一十五万度，其中 ORC 发电三十七万度，
> 年减排二氧化碳一千七百七十六吨。

**操作 3**：证明是活的计算，不是写死的数字：

```powershell
node scripts/trigger.cjs "西北高辐照 10MW"
```

**旁白**：

> 换个场景再跑一次：西北高辐照、十兆瓦。数字随参数变化，
> 说明背后是真实的工程计算。

**操作 4**：展示服务端任务记录（可核验证据）：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/simulations?limit=8 |
  Select-Object -ExpandProperty jobs | Format-Table createdAt,status,presetId
```

**旁白**：

> 这是仿真服务自己的任务记录，每一次仿真都留痕，任何人都可以核对。

---

### 镜头 4 ｜ 2:45—3:35 ｜ 开源改进与开放成果

**画面**：终端 B。

**操作**：

```powershell
# 1) 框架已识别我们的 Skill（这是"开源改进"最直接的证据）
cd "$env:USERPROFILE\Desktop\DS Harness\upstream\openclaw-main"
pnpm openclaw skills list | Select-String "solar"
cd "$env:USERPROFILE\Desktop\DS Harness\work\solarglyph-skill"

# 2) 自检七项全绿
node scripts/verify-skill.cjs

# 3) 提交边界：Skill 是单独提交的
git log --oneline --graph --all
git show --stat 18f53817
```

**旁白**：

> 相对上游 OpenClaw，我们的实质改进有三处：
> 新增垂直场景 Skill、自研配套仿真服务、打通完整自动化闭环。
> 框架已把我们的 Skill 识别为 ready、来源标注 workspace，
> 说明它是被正式加载的扩展，而不是改上游源码。
> 自检七项全部通过；提交历史里 Skill 是单独的分支、单独的提交，与上游快照边界清晰。
> 上游快照是官方发布包的字节级一致副本，我们一行源码都没改。
> 仓库地址已写在技术报告附录里，公开可访问。

**操作提示**：最后把浏览器切到仓库首页 <https://github.com/uberjl136/openclaw-solarglyph>，
展示两个分支和提交列表（3—5 秒）。

---

### 镜头 5 ｜ 3:35—4:00 ｜ 收尾

**画面**：定格在结果表或仓库页面。

**旁白**：

> 一句话总结：原本需要人工核算数天的方案评估，
> 现在一句中文指令就能完成，而且结果可复现、过程可追溯。
> 我们也如实说明边界：辐照数据采用区域年值加几何近似，不是八七六零小时逐时模拟，
> 结果用于方案比选，不替代正式的可行性研究。这些限制都写在技术报告里。

**结束**。

---

## 第四步：录完之后（约 15 分钟）

### 4.1 检查时长与体积

要求：**3:00—5:00**、**≤300 MB**。

在文件管理器里右键视频 → 属性，看大小；播放器里看时长。

- **超过 5 分钟** → 用系统自带"照片"应用或剪映裁掉多余停顿
- **超过 300 MB** → 用剪映/格式工厂重新导出，码率降到 4000—6000 Kbps

### 4.2 可选：让剪辑更干净

用 **剪映专业版**（免费）或系统"照片"应用：

1. 掐掉开头结尾的空白与误操作
2. 在关键数字出现时加**文字标注**（如"年发电量 499.5 万 kWh"）
3. 加一个 3 秒片头标题：作品名称
4. 导出：1080p / 30fps / MP4

### 4.3 最终自查清单（逐条打勾）

- [ ] 时长在 **3—5 分钟**
- [ ] 格式 **MP4**，体积 **≤300 MB**
- [ ] 全片**没有**学校名称、LOGO、指导教师信息
- [ ] 没有 API 密钥、账号密码、SSH 私钥出现在画面里
- [ ] 三个服务都正常启动，演示没有报错
- [ ] 镜头 3 的轮询过程**连续未剪断**
- [ ] 旁白能听清，没有环境噪音
- [ ] 出现了：核心功能、操作流程、实现效果、开源改进、仓库链接

---

## 附：常见问题

**Q：Gateway 起不来怎么办？**
本次演示**不强制需要** Gateway。镜头 1 和镜头 3 用的都是命令行，只要仿真服务（终端 A）在跑即可。Gateway 只在你想展示网页控制台时才需要。

**Q：自然语言触发的效果要不要录？**
本机 8B 小模型能触发，但需要精简配置且不太稳定。**建议录像用 `trigger.cjs`**（确定性入口，每次必成），并在旁白里说明"自然语言触发同样可用，需配置具备工具调用能力的模型"。这样既真实又不会录废。

**Q：录音噪音大 / 不想配音？**
可以先用 OBS 只录屏幕，再单独录旁白，最后在剪映里对齐；或者直接加**字幕**替代旁白（但官方要求"清晰展示"，**有配音更好**）。

**Q：想重录某个镜头？**
建议**分段录**（一个镜头一个文件），最后拼接。这样重录成本低，也不怕一次录错全废。
