# WorldSea 单文件安装器构建链
#   [1/3] 主程序 release 构建（identifier/proc_quiet 等 最新变更进包，同时产出 NSIS 包）
#   [2/3] 主程序 exe → apps/installer/src-tauri/payload/（安装器编译期 include_bytes! 依赖它，缺失则编译失败）
#   [3/3] 安装器构建 → 单文件 worldsea-installer.exe
# 用法：
#   scripts/build-installer.ps1              # 完整链
#   scripts/build-installer.ps1 -SkipMainApp # 主程序未变时只重打安装器
param([switch]$SkipMainApp)
$ErrorActionPreference = 'Stop'
$root      = (Get-Item $PSScriptRoot).Parent.FullName
$mainApp   = Join-Path $root 'apps\tauri\src-tauri'
$installer = Join-Path $root 'apps\installer\src-tauri'
$payloadDir = Join-Path $installer 'payload'
$mainExe    = Join-Path $mainApp 'target\release\worldsea-tauri-app.exe'
$tauriCli   = Join-Path $root 'apps\tauri\node_modules\.bin\tauri.cmd'

if (-not $SkipMainApp) {
    "=== [1/3] 主程序 release 构建（含 NSIS 包）==="
    Push-Location (Join-Path $root 'apps\tauri')
    & pnpm tauri build --bundles nsis 2>&1 | Select-Object -Last 4
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw '主程序构建失败' }
} else {
    "=== [1/3] 跳过主程序构建（-SkipMainApp）==="
    if (-not (Test-Path $mainExe)) { throw '主程序 exe 不存在：先跑完整构建（去掉 -SkipMainApp）' }
}

"=== [2/3] 同步 payload（编译期嵌入源）==="
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
Copy-Item $mainExe (Join-Path $payloadDir 'worldsea-tauri-app.exe') -Force
$runtimeZip = Join-Path $root 'apps\tauri\src-tauri\payload\dsh-runtime.zip'
if (-not (Test-Path $runtimeZip)) { throw "dsh 运行时包不存在：$runtimeZip（先跑 scripts\build-dsh-runtime.ps1）" }
Copy-Item $runtimeZip (Join-Path $payloadDir 'dsh-runtime.zip') -Force

"=== [3/3] 安装器构建（单文件）==="
Push-Location $installer
& $tauriCli build --no-bundle 2>&1 | Select-Object -Last 4
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw '安装器构建失败' }

"=== 完成 ==="
"单文件安装器: $installer\target\release\worldsea-installer.exe"
"NSIS 备选包:  $mainApp\target\release\bundle\nsis\WorldSea_0.1.0_x64-setup.exe"
