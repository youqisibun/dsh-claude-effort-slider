<#
  把本插件装进某个 DSH profile（默认 desktop）。

  为什么需要它：`desktop` 是 Electron 应用保留的 profile，命令行 `dsh plugin --profile desktop …`
  会被直接拒绝（"managed exclusively by the Electron application"）；当 DSH 的设置侧栏里
  没有「插件」面板时（`profileContext` 没挂上，`dsh-base` 会把整行 `plugin-manager` disabled），
  就只能手工改 profile 的 package.json + 建一个链接。这个脚本把那几步封装起来。

  用法：
    pwsh -File install-profile.ps1                    # 装进 desktop
    pwsh -File install-profile.ps1 -Profile tui       # 装进别的 profile
    pwsh -File install-profile.ps1 -WhatIf            # 只看要做什么，不落盘
    pwsh -File install-profile.ps1 -Uninstall         # 卸载（还原依赖与 bundles）

  做的事（每一步都会打印）：
    1. 备份 profile 的 package.json（带时间戳）
    2. 加一条 `link:` 依赖指向本插件目录
    3. 把包名追加进 `dsh.profile.bundles`
    4. 在 profile 的 node_modules 下建链接（Windows 用 junction，其它平台用符号链接）
    5. 校验写回的文件能解析、两项都在
  之后**完全退出并重开** DSH Desktop 才生效。
#>
[CmdletBinding()]
param(
  [string]$Profile = "desktop",
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }),
  [string]$PluginDir = "",
  [switch]$Uninstall,
  [switch]$WhatIf
)

# PS 5.1 里 $PSScriptRoot 在参数默认值求值时可能是空的，所以在这里兜底
if (-not $PluginDir) {
  $PluginDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
}

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Say($message) { Write-Host "  $message" }
function Fail($message) { Write-Host "✗ $message" -ForegroundColor Red; exit 1 }
function Warn($message) { Write-Host "! $message" -ForegroundColor Yellow }

Write-Host "`n=== dsh-claude-effort-slider 安装器 ===" -ForegroundColor Cyan
Say "DSH home     : $DshHome"
Say "profile      : $Profile"
Say "插件目录     : $PluginDir"
Say "模式         : $(if ($Uninstall) { '卸载' } else { '安装' })"

# ── 环境体检（只警告，不阻断：这些问题大多能继续装，但值得知道）─────────────
Write-Host "`n--- 环境体检 ---"

# Node 版本：DSH 要求 >=22，本插件的 engines 也写了 >=22
$nodeMajor = $null
try {
  $nodeVer = (& node -v 2>$null)
  if ($nodeVer -match 'v(\d+)\.') { $nodeMajor = [int]$Matches[1] }
} catch { }
if ($null -eq $nodeMajor) {
  Warn "PATH 里找不到 node。DSH 本身需要 Node >=22，先装 Node 再继续。"
} elseif ($nodeMajor -lt 22) {
  Warn "Node 是 v$nodeMajor，本插件要求 >=22。装上了也可能在启动时被 engines 拦下。"
} else {
  Say "node v$nodeMajor ✓"
}

# 非 ASCII 路径：mklink /J 在 cmd 层处理中文路径时可能失败
if ($PluginDir -match '[^\x00-\x7F]') {
  Warn "插件目录含中文/非 ASCII 字符：$PluginDir"
  Warn "Windows 的 mklink 走 cmd 代码页，这类路径有概率建链接失败。若下面校验的 node_modules 是 ✗，把插件挪到纯英文路径再重跑。"
} else {
  Say "插件路径纯 ASCII ✓"
}

# DSH 版本：低于 0.2.1-rc.2 时插槽与模型席形状可能对不上
try {
  $dshVer = (& dsh --version 2>$null | Select-Object -First 1)
  if ($dshVer) { Say "dsh $dshVer" }
} catch { }

# pnpm：DSH 的 profile 用 pnpm 管理依赖；缺失时手动建的链接仍可用，但后续 install 会清掉
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCmd) { Say "pnpm 可用 ✓" } else { Warn "PATH 里没有 pnpm。DSH 通常自带，若之后执行 pnpm install，手建的链接可能被覆盖。" }

# ── 前置检查 ────────────────────────────────────────────────────────────────
$profileDir = Join-Path $DshHome (Join-Path "profiles" $Profile)
if (-not (Test-Path $profileDir)) {
  Fail "找不到 profile 目录：$profileDir`n  先用 DSH 启动过一次这个 profile（例如 `dsh --profile $Profile`），它才会被创建。"
}
$manifestPath = Join-Path $profileDir "package.json"
if (-not (Test-Path $manifestPath)) { Fail "profile 里没有 package.json：$manifestPath" }
if (-not $Uninstall) {
  $pluginManifest = Join-Path $PluginDir "package.json"
  if (-not (Test-Path $pluginManifest)) { Fail "插件目录里没有 package.json：$PluginDir" }
  $plugin = Get-Content $pluginManifest -Raw -Encoding utf8 | ConvertFrom-Json
  if (-not $plugin.name) { Fail "插件 package.json 里没有 name" }
  if (-not $plugin.dsh.bundle.patch) { Fail "插件没有声明 dsh.bundle.patch（DSH 需要它来挂进组合包）" }
}
$name = if ($Uninstall) { "dsh-claude-effort-slider" } else { $plugin.name }

# ── 读 profile 清单 ────────────────────────────────────────────────────────
$raw = Get-Content $manifestPath -Raw -Encoding utf8
try { $manifest = $raw | ConvertFrom-Json } catch { Fail "profile 的 package.json 解析失败：$($_.Exception.Message)" }
if (-not $manifest.PSObject.Properties["dependencies"]) {
  $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
if (-not $manifest.PSObject.Properties["dsh"]) {
  $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force
}

$depSpec = "link:" + ($PluginDir -replace "\\", "/")
if ($Uninstall) {
  if ($manifest.dependencies.PSObject.Properties[$name]) { $manifest.dependencies.PSObject.Properties.Remove($name) }
  $bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $name })
} else {
  $manifest.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $depSpec -Force
  $bundles = @($manifest.dsh.profile.bundles)
  if ($bundles -notcontains $name) { $bundles += $name }
}
if (-not $manifest.dsh.PSObject.Properties["profile"]) {
  $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force
}
$manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force

$json = $manifest | ConvertTo-Json -Depth 20
try { $null = $json | ConvertFrom-Json } catch { Fail "写回前校验失败（不会落盘）：$($_.Exception.Message)" }

Write-Host "`n--- 将要写入的改动 ---"
Say "dependencies[""$name""] = $(if ($Uninstall) { '(移除)' } else { $depSpec })"
Say "dsh.profile.bundles  = $($bundles -join ', ')"

if ($WhatIf) { Write-Host "`n（-WhatIf：没有落盘）" -ForegroundColor Yellow; exit 0 }

# ── 备份 + 落盘 ────────────────────────────────────────────────────────────
$backup = "$manifestPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $manifestPath $backup -Force
Say "`n已备份：$backup"
# 必须写成**无 BOM** 的 UTF-8：Node/pnpm 的 JSON.parse 遇到 BOM 会直接失败
[System.IO.File]::WriteAllText($manifestPath, $json, $utf8NoBom)
Say "已写入：$manifestPath"

# ── 链接 ───────────────────────────────────────────────────────────────────
$modulesDir = Join-Path $profileDir "node_modules"
$linkPath = Join-Path $modulesDir $name
if ($Uninstall) {
  if (Test-Path $linkPath) {
    # 只删链接本体：junction 必须用 rmdir，Remove-Item -Recurse 会顺着链接删到插件目录里去
    if ($env:OS -eq "Windows_NT") { cmd /c rmdir "$linkPath" | Out-Null } else { Remove-Item $linkPath -Force }
    Say "已移除链接：$linkPath"
  }
} else {
  New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
  if (Test-Path $linkPath) {
    if ($bundles -contains $name) {
      Say "看起来已经装过了（依赖、bundles、链接都在）。本次只做刷新；如需重装请先 -Uninstall。"
    } else {
      Say "链接已存在，跳过：$linkPath"
    }
  }
  elseif ($env:OS -eq "Windows_NT") {
    cmd /c mklink /J "$linkPath" "$PluginDir" | Out-Null
    Say "已建 junction：$linkPath → $PluginDir"
  } else {
    New-Item -ItemType SymbolicLink -Path $linkPath -Target $PluginDir | Out-Null
    Say "已建符号链接：$linkPath → $PluginDir"
  }
}

# ── 校验 ───────────────────────────────────────────────────────────────────
$check = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$okDep = if ($Uninstall) { -not $check.dependencies.PSObject.Properties[$name] } else { $check.dependencies.PSObject.Properties[$name].Value -eq $depSpec }
$okBundle = if ($Uninstall) { @($check.dsh.profile.bundles) -notcontains $name } else { @($check.dsh.profile.bundles) -contains $name }
$okLink = if ($Uninstall) { -not (Test-Path $linkPath) } else { Test-Path $linkPath }
Write-Host "`n--- 校验 ---"
Say "dependencies : $(if ($okDep) { '✓' } else { '✗' })"
Say "bundles      : $(if ($okBundle) { '✓' } else { '✗' })"
Say "node_modules : $(if ($okLink) { '✓' } else { '✗' })"
if (-not ($okDep -and $okBundle -and $okLink)) { Fail "校验没过，请用备份还原：$backup" }

if ($Uninstall) {
  Write-Host "`n卸载完成。完全退出并重开 DSH Desktop 后生效。`n" -ForegroundColor Green
} else {
  Write-Host "`n安装完成 ✅  现在**完全退出并重开** DSH Desktop（关窗口不够，要退出进程）。" -ForegroundColor Green
  Write-Host "重开后输入框右下角的档位会变成可点胶囊，点它就能打开滑条。`n"
}
