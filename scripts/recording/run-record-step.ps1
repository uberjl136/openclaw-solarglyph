# ============================================================
#  录视频用的分步执行脚本（由同目录的 run-record-step.bat 调用）
#
#      run-record-step.bat 1   卸载技能，列出上游能力（21/57）
#      run-record-step.bat 2   装回技能，显示被识别（22/58）
#      run-record-step.bat 3   跑仿真，出结果（核心演示）
#      run-record-step.bat 4   自检 + 提交历史
#
#  作用：把录视频时要打的命令固定下来，避免手打或粘贴出错。
#  路径从脚本自身位置推导，所以仓库放在哪里都能用。
# ============================================================

param([Parameter(Mandatory = $true)][string]$Shot)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# 本脚本位于 <repo>\scripts\recording，所以：
#   $PSScriptRoot  ->  <repo>\scripts\recording
#   上两层          ->  <repo>
#   再上两层        ->  <DS Harness>（仓库的上级目录，tools 和 upstream 都在这里）
$Repo     = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Root     = Split-Path -Parent (Split-Path -Parent $Repo)
$Upstream = Join-Path $Root 'upstream\openclaw-main'

# 每次运行都准备好必需设定，避免"忘了设"导致报错
$StateDir = Join-Path $Repo '..\openclaw-state'
$StateDir = [System.IO.Path]::GetFullPath($StateDir)
$env:OPENCLAW_STATE_DIR = $StateDir
$env:OPENCLAW_WORKSPACE = Join-Path $StateDir 'workspace'

$NpmGlobal = Join-Path $Root 'tools\npm-global'
$GitCmd    = Join-Path $Root 'tools\git\cmd'
$env:PATH = "$NpmGlobal;$GitCmd;$env:PATH"

function Head($t) {
    Write-Host ''
    Write-Host ('=' * 62)
    Write-Host "  $t"
    Write-Host ('=' * 62)
}

if (-not (Test-Path (Join-Path $Repo 'scripts'))) {
    Write-Host "[错误] 找不到项目目录：$Repo"
    exit 1
}

# pnpm 会把"它正在执行的命令"写到 stderr。在 $ErrorActionPreference='Stop' 下
# PowerShell 会把它当成致命错误并中断管道，所以先把输出整体收进变量再筛选。
function Show-SkillsList {
    param([string[]]$Patterns)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & pnpm.cmd openclaw skills list 2>&1 | Out-String
    } finally {
        $ErrorActionPreference = $prev
    }
    $raw -split "`r?`n" | Where-Object {
        $line = $_
        @($Patterns | Where-Object { $line -match $_ }).Count -gt 0
    } | ForEach-Object { Write-Host $_ }
}

switch ($Shot) {

    '1' {
        Head '镜头 1：未做扩展的原版（上游基线）'
        Write-Host ''
        Write-Host '--- 第一步：把本次作品新增的技能卸载掉 ---'
        Set-Location $Repo
        & node 'scripts\uninstall-skill.cjs'
        Write-Host ''
        Write-Host '--- 第二步：列出上游自带能力 ---'
        Set-Location $Upstream
        Show-SkillsList @('Skills \(')
        Write-Host ''
        Write-Host '预期：显示 Skills (21/57 ready)，且看不到 solar-glyph-simulation'
    }

    '2' {
        Head '镜头 2：装回技能，框架识别为 ready'
        Write-Host ''
        Write-Host '--- 第一步：安装本次作品新增的技能 ---'
        Set-Location $Repo
        & node 'scripts\install-skill.cjs'
        Write-Host ''
        Write-Host '--- 第二步：确认框架已识别 ---'
        Set-Location $Upstream
        Show-SkillsList @('Skills \(', 'solar')
        Write-Host ''
        Write-Host '预期：显示 Skills (22/58 ready)，并多出一行 solar-glyph-simulation'
    }

    '3' {
        Head '镜头 3：核心演示 —— 自动跑完一次仿真'
        Set-Location $Repo
        Write-Host ''
        Write-Host '--- 第 1 次：中文指令“启动光伏余热仿真” ---'
        Write-Host ''
        & node 'scripts\trigger.cjs' '启动光伏余热仿真'
        Write-Host ''
        Write-Host '--- 第 2 次：换一个场景，证明数字是算出来的 ---'
        Write-Host ''
        & node 'scripts\trigger.cjs' '西北高辐照 10MW'
        Write-Host ''
        Write-Host '--- 第 3 项：服务自己的任务记录（可核验） ---'
        Write-Host ''
        try {
            Invoke-RestMethod 'http://127.0.0.1:8787/v1/simulations?limit=8' -TimeoutSec 10 |
                Select-Object -ExpandProperty jobs |
                Format-Table createdAt, status, presetId -AutoSize
        } catch {
            Write-Host '  [提示] 计算服务没在运行。另开一个窗口运行：'
            Write-Host "         node `"$Repo\solarglyph-core\server.js`""
        }
    }

    '4' {
        Head '镜头 4：自检结果与提交边界'
        Set-Location $Repo
        Write-Host ''
        Write-Host '--- 自检：七项 ---'
        & node 'scripts\verify-skill.cjs'
        Write-Host ''
        Write-Host '--- 提交历史：自研部分是独立的一条线 ---'
        & git log --oneline --graph --all
        Write-Host ''
        Write-Host '--- 技能是单独的一次提交 ---'
        & git show --stat --oneline 18f53817 2>&1 | Select-Object -First 12
    }

    default {
        Write-Host "未知的镜头编号：$Shot"
        Write-Host '可用：1 / 2 / 3 / 4'
        exit 2
    }
}

Write-Host ''
Write-Host ('=' * 62)
Write-Host '  这一段执行完毕'
Write-Host ('=' * 62)
Write-Host ''
