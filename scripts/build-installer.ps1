# WorldSea 单文件安装器构建链
#   [1/4] 工作台 UI 构建（vite → workspace-dist，壳协议运行时读盘）
#   [2/4] 主程序 release 构建（bundle.resources 携带 workspace-dist + dsh-runtime.zip，同时产出 NSIS 包）
#   [3/4] 主程序 exe 与工作台产物 → payload（安装器编译期 include_bytes! 依赖，缺失则编译失败）
#   [4/4] 安装器构建 → 单文件 worldsea-installer.exe
# 用法：
#   scripts/build-installer.ps1              # 完整链
#   scripts/build-installer.ps1 -SkipMainApp # 主程序未变时只重打安装器
param([switch]$SkipMainApp)
$ErrorActionPreference = 'Stop'
$root      = (Get-Item $PSScriptRoot).Parent.FullName
$mainApp   = Join-Path $root 'apps\tauri\src-tauri'
$installer = Join-Path $root 'apps\installer\src-tauri'
$payloadDir = Join-Path $installer 'payload'
$workspaceDir = Join-Path $root 'apps\tauri\workspace-dist'
$workspaceZip = Join-Path $payloadDir 'workspace-dist.zip'
$mainExe    = Join-Path $mainApp 'target\release\worldsea-tauri-app.exe'
$runtimeZip = Join-Path $mainApp 'payload\dsh-runtime.zip'
$tauriCli   = Join-Path $root 'apps\tauri\node_modules\.bin\tauri.cmd'

"=== [1/4] 工作台 UI 构建 ==="
Push-Location (Join-Path $root 'apps\tauri')
& node (Join-Path $root 'node_modules\vite\bin\vite.js') build --config workspace/vite.config.ts 2>&1 | Select-Object -Last 6
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw '工作台 UI 构建失败' }
if (-not (Test-Path (Join-Path $workspaceDir 'index.html'))) { throw "工作台产物缺失：$workspaceDir\index.html" }

if (-not $SkipMainApp) {
    "=== [2/4] 主程序 release 构建（含 NSIS 包）==="
    if (-not (Test-Path $runtimeZip)) { throw "dsh 运行时包不存在：$runtimeZip（先跑 scripts\build-dsh-runtime.ps1）" }
    Push-Location (Join-Path $root 'apps\tauri')
    & pnpm tauri build --bundles nsis 2>&1 | Select-Object -Last 4
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw '主程序构建失败' }
} else {
    "=== [2/4] 跳过主程序构建（-SkipMainApp）==="
    if (-not (Test-Path $mainExe)) { throw '主程序 exe 不存在：先跑完整构建（去掉 -SkipMainApp）' }
}

"=== [3/4] 同步 payload（编译期嵌入源）==="
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
Copy-Item $mainExe (Join-Path $payloadDir 'worldsea-tauri-app.exe') -Force
if (Test-Path $workspaceZip) { Remove-Item -Force $workspaceZip }
# includeBaseDirectory = 包内保留 workspace-dist/ 顶层前缀（安装器解压到安装根即得 exe 同级目录）
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $workspaceDir, $workspaceZip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
if (-not (Test-Path $runtimeZip)) { throw "dsh 运行时包不存在：$runtimeZip（先跑 scripts\build-dsh-runtime.ps1）" }
Copy-Item $runtimeZip (Join-Path $payloadDir 'dsh-runtime.zip') -Force

"=== [4/4] 安装器构建（单文件）==="
Push-Location $installer
& $tauriCli build --no-bundle 2>&1 | Select-Object -Last 4
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw '安装器构建失败' }

"=== 完成 ==="
"单文件安装器: $installer\target\release\worldsea-installer.exe"
"NSIS 备选包:  $mainApp\target\release\bundle\nsis\WorldSea_0.1.0_x64-setup.exe"
