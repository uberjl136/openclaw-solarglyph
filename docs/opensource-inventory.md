# 开源资源清单登记条目

按比赛要求登记本项目使用的开源资源。可直接抄入《开源资源清单》表格。

| 字段 | 内容 |
| --- | --- |
| 资源名称 | OpenClaw |
| 项目定位 | 通用 AI 智能体底座（多渠道接入、工具调用、Skill/插件体系、Gateway 控制面） |
| 上游仓库 | <https://github.com/openclaw/openclaw> |
| 采用版本 | `2026.9.4` |
| 快照提交 | `ad1c9345f2cbbeee32fc006b963da86001bffbaa`（`main`，2026-09-16） |
| 开源许可证 | **MIT License**，Copyright (c) 2026 OpenClaw Foundation（全文见 `upstream/openclaw-main/LICENSE`） |
| 使用方式 | 本地部署运行；**未修改其底层源码** |
| 我方扩展 | 新增垂直场景 Skill `solar-glyph-simulation`，通过 HTTP 对接自研 SolarGlyph 光伏-余热仿真服务 |
| 扩展代码位置 | `work/solarglyph-skill/`（独立 git 仓库与开发分支） |
| 部署说明 | 见本仓库 `README.md` 与 `docs/deployment.md` |

## 说明文字（用于报告正文）

> 本项目基于开源项目 **OpenClaw**（MIT 协议，通用 AI 智能体底座）进行垂直场景扩展。
> 我们完整部署并跑通了上游原版框架，**未改动其底层源码**；在此之上自研了
> **光伏-新能源仿真 Skill**（`solar-glyph-simulation`），并实现了与自研
> **SolarGlyph 仿真平台**的 HTTP 对接：AI 下发仿真任务 → 启动仿真 → 轮询作业状态 →
> 取回仿真结果并产出工程报告，形成完整自动化闭环。
>
> 上游原版不具备任何光伏、辐照、余热或电力工程计算能力（其 50 余个内置 Skill 均为通用
> 任务能力）。我们的增量在于：把行业工程算法固化为可调用的仿真服务，并通过 Skill 让通用
> 智能体在无人干预下完成一次完整的工程仿真任务。Skill 与仿真服务单独成库、单独提交，
> 与上游快照边界清晰、可逐行核查。

## 其他引用

| 资源 | 用途 | 许可/性质 |
| --- | --- | --- |
| SolarGlyph 工程站点 <https://solarglyph.newenergycoder.club/simulation> | 光伏/辐照/储热/电气算法的逆向来源（逐条对照见 `docs/solarglyph-algorithm-provenance.md`） | 自有/团队工程资产 |
| Node.js | 运行时（仿真服务零第三方依赖） | MIT |
| pnpm `12.3.4` | 上游依赖管理（上游 `packageManager` 指定） | MIT |
| 上游内置依赖 | 仅用于运行 OpenClaw 本体，未修改 | 各自许可证见 `upstream/openclaw-main/THIRD_PARTY_NOTICES.md` |

## 合规声明

- 上游源码保持原样，未做任何功能性修改；上游 `LICENSE` 与署名完整保留。
- 我方新增代码以 MIT 协议发布（见 `LICENSE`），**不改变上游许可条款**。
- 本项目不包含任何真实 API 密钥、账号令牌或个人数据。
