# 构建 WorldSea 随安装器分发的 dsh 运行时（node 载体形态）。
# 配方来源：dsh 上游单 exe 构建的 node 分支（.agents/notes/implemented/architecture/
# 2026-07-10-single-file-executable-sdk-runtime-distribution.md §Build pipeline）：
#   闭包清单 + pnpm deploy --legacy --node-linker=hoisted --auto-install-peers=false。
# 产物布局：<Out>/node/node.exe + <Out>/dsh/（部署树，CLI 位于 dsh/node_modules/@deepseek-ai/dsh）。
# 追版动作 = 替换 dsh/ 树 → 重跑本脚本（闭包清单自动重新推导 + 烟测自动执行）。
param(
    # 产物目录（默认打进安装器 payload；payload 目录已 gitignore）
    [string]$OutDir = (Join-Path $PSScriptRoot '..\apps\tauri\src-tauri\payload\dsh-runtime'),
    # 下载缓存（node zip 等，sha256 寻址）
    [string]$CacheDir = (Join-Path $env:TEMP 'worldsea-dsh-runtime-cache'),
    # 跳过烟测（产线不建议）
    [switch]$SkipSmoke
)
$ErrorActionPreference = 'Stop'
$repo = (Get-Item $PSScriptRoot).Parent.FullName
$dsh = Join-Path $repo 'dsh'
# 清理上次运行中断残留的临时目录（guid 后缀，均为本脚本私有用完即弃的中间态）
Get-ChildItem $env:TEMP -Directory -Filter 'worldsea-dsh-stage-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $env:TEMP -Directory -Filter 'worldsea-dsh-deploy-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $env:TEMP -Directory -Filter 'worldsea-node-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
# 与 dsh 上游锁定的 node 版本一致（dsh/scripts/primary-runtime/lock.json），追版时同步
$nodeVersion = '24.21.0'
$nodeSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$stage = Join-Path $env:TEMP ('worldsea-dsh-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Step([string]$name) { Write-Host "[dsh-runtime] $name" }

# ---------- 1. staging：修剪复制 + 注入插件 + 中和根生命周期脚本 ----------
Step "staging -> $stage"
robocopy $dsh $stage /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git .dsh-build .agents .github website docs benchmarks snapshots python .vscode .mimosa .omo .workbuddy .zcode .codebuddy .catpaw .arts .screenshots .devtmp | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败：$LASTEXITCODE" }
# 工作区清单去掉 website/benchmarks/python 三个成员（源目录已修剪，保留会安装失败）
$wsPath = Join-Path $stage 'pnpm-workspace.yaml'
(Get-Content $wsPath -Raw) -replace "  - benchmarks\r?\n", '' -replace "  - website\r?\n", '' -replace "  - python/sdk-runtime\r?\n", '' |
    Set-Content $wsPath -Encoding utf8NoBOM
# 根 postinstall（lefthook git 钩子）在 staging 无 node_modules 必然失败且对产物无意义，剥离
$rootManifestPath = Join-Path $stage 'package.json'
$rootManifest = Get-Content $rootManifestPath -Raw | ConvertFrom-Json
foreach ($n in @('postinstall', 'preinstall', 'prepare', 'prepack')) {
    if ($rootManifest.scripts.PSObject.Properties[$n]) { $rootManifest.scripts.PSObject.Properties.Remove($n) }
}
$rootManifest | ConvertTo-Json -Depth 10 | Set-Content $rootManifestPath -Encoding utf8NoBOM
# 注入产品域插件（apps/dsh-plugin-* 通配收编——新增插件零接线，不进名单就不会漏）
$plugins = Get-ChildItem (Join-Path $repo 'apps') -Directory -Filter 'dsh-plugin-*'
if (-not $plugins -or @($plugins).Count -eq 0) { throw "apps/ 下没有 dsh-plugin-* 插件包" }
foreach ($p in $plugins) { Copy-Item $p.FullName (Join-Path $stage "apps\$($p.Name)") -Recurse }

# ---------- 2. 闭包清单：种子（CLI deps ∪ 全树 workspace peers ∪ overrides 实体包 ∪ bundle 引用 ∪ 插件）+ 迭代校验补缺 ----------
Step '生成闭包清单'
# 工作区包索引（name -> 目录）：闭包种子与恢复步骤共用
$wsPkgs = @{}
Get-ChildItem $stage -Recurse -Filter package.json -Depth 4 | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
    try { $j = Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { return }
    if ($j.name) { $wsPkgs[$j.name] = $_.Directory.FullName }
}
$closureDir = Join-Path $stage 'apps\worldsea-closure'
New-Item -ItemType Directory -Force $closureDir | Out-Null
$closurePath = Join-Path $closureDir 'package.json'
$cli = Get-Content (Join-Path $stage 'apps\cli\package.json') -Raw | ConvertFrom-Json
$cliDeps = @($cli.dependencies.PSObject.Properties.Name) + @($cli.devDependencies.PSObject.Properties.Name)
# 全树 workspace 协议 peerDependencies（闭包校验要求平铺声明全部传递 peer）
$peers = @{}
Get-ChildItem $stage -Recurse -Filter package.json -Depth 4 | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
    try { $j = Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { return }
    if ($j.peerDependencies) {
        $j.peerDependencies.PSObject.Properties | Where-Object { $_.Value -like 'workspace:*' } | ForEach-Object { $peers[$_.Name] = $true }
    }
}
$deps = [ordered]@{}
$deps['@deepseek-ai/dsh'] = 'workspace:*'
foreach ($p in $peers.Keys) {
    if ($cliDeps -contains $p) { continue }
    $deps[$p] = if ($p -match 'cordis|cosmokit|schemastery') { 'workspace:~' } else { 'workspace:*' }
}
# overrides 强制链接的 vendor 包（peer 扫描覆盖不到，缺了运行时才爆）
foreach ($p in @('@deepseek-ai/cosmokit', '@deepseek-ai/schemastery')) { $deps[$p] = 'workspace:~' }
foreach ($p in $plugins) { $deps[$p.Name] = 'workspace:*' }
# bundle 装配引用的 workspace 包：上游 verify 脚本只扫 presets/*.patch.yml，
# bundle 层 cordis*.yml 引用的包（如 dsh-llm-deepseek，CLI 的 devDep）它不查——运行时才爆，这里静态补齐
Get-ChildItem (Join-Path $stage 'packages\bundle') -Recurse -Include 'cordis*.yml', '*.patch.yml' -File | ForEach-Object {
    (Select-String -Path $_.FullName -Pattern "['""](@deepseek-ai/[\w-]+)['""]" -AllMatches).Matches |
        ForEach-Object { $_.Groups[1].Value }
} | Sort-Object -Unique | Where-Object { $wsPkgs.ContainsKey($_) -and -not $deps[$_] } |
    ForEach-Object { $deps[$_] = 'workspace:*' }
[ordered]@{ name = 'worldsea-dsh-closure'; version = '0.0.0'; private = $true
    description = 'WorldSea 生产部署闭包清单（构建期注入 staging，不入库）'; type = 'module'
    dependencies = $deps } | ConvertTo-Json -Depth 5 | Set-Content $closurePath -Encoding utf8NoBOM
# 迭代：跑上游校验脚本（在真实 dsh 树执行，manifest 传 staging 绝对路径），把失败链末端包补进清单
for ($i = 0; $i -lt 15; $i++) {
    Push-Location $dsh
    try { $out = pnpm exec tsx scripts/verify-runtime-closure.ts --manifest $closurePath 2>&1 | Out-String; $rc = $LASTEXITCODE } finally { Pop-Location }
    if ($rc -eq 0) {
        $count = ((Get-Content $closurePath -Raw | ConvertFrom-Json).dependencies.PSObject.Properties | Measure-Object).Count
        Step "闭包校验通过（迭代 $i 轮，$count 项依赖）"; break
    }
    $missing = @()
    foreach ($line in ($out -split "`n")) {
        if ($line -match 'worldsea-dsh-closure.*->\s*(@[\w-]+/[\w.-]+|[\w-]+)\s*$') { $missing += $Matches[1] }
        elseif ($line -match 'preset\s*->\s*(@[\w-]+/[\w.-]+|[\w-]+)') { $missing += $Matches[1] }
    }
    $missing = @($missing | Sort-Object -Unique | Where-Object { $_ })
    if ($missing.Count -eq 0) { throw "闭包校验失败且无法解析缺失项：`n$($out.Substring([math]::Max(0, $out.Length - 1500)))" }
    $m = Get-Content $closurePath -Raw | ConvertFrom-Json
    foreach ($p in $missing) {
        if (-not $m.dependencies.PSObject.Properties[$p]) {
            $m.dependencies | Add-Member -NotePropertyName $p -NotePropertyValue $(if ($p -match 'cordis|cosmokit|schemastery') { 'workspace:~' } else { 'workspace:*' })
        }
    }
    $m | ConvertTo-Json -Depth 5 | Set-Content $closurePath -Encoding utf8NoBOM
}

# ---------- 3. deploy（pnpm@11.7.0 = dsh packageManager 锁定版本）+ 修正 ----------
Step 'deploy（legacy hoisted 配方）'
$deploy = Join-Path $env:TEMP ('worldsea-dsh-deploy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Push-Location $stage
try {
    # 不走 npx：本机 npm 11.19 的 npx 会崩（minipass-flush），pnpm dlx 拉同一版本更稳
    pnpm dlx pnpm@11.7.0 --filter worldsea-dsh-closure --prod deploy --legacy `
        --config.allow-unused-patches=true --config.node-linker=hoisted `
        --config.auto-install-peers=false --config.link-workspace-packages=true $deploy 2>&1 | ForEach-Object { Write-Verbose $_ }
    if ($LASTEXITCODE -ne 0) { throw "pnpm deploy 失败：$LASTEXITCODE" }
} finally { Pop-Location }

Step '修正：恢复 legacy deploy 漏装的 workspace 包'
# legacy deploy 会漏装部分 workspace 包（上游单 exe 构建同样有恢复步骤）。
# 判定基准 = 闭包清单的 **workspace 传递闭包**（BFS manifests）——直接依赖与传递依赖都比对，
# 缺的从 staging 源目录整包恢复（dsh-base 是 CLI 的传递依赖，只查直接依赖会漏）。
$deployNm = Join-Path $deploy 'node_modules'
$need = New-Object System.Collections.Queue
(Get-Content $closurePath -Raw | ConvertFrom-Json).dependencies.PSObject.Properties.Name | ForEach-Object { $need.Enqueue($_) }
$seen = @{}
while ($need.Count -gt 0) {
    $n = $need.Dequeue()
    if ($seen.ContainsKey($n) -or -not $wsPkgs.ContainsKey($n)) { continue }
    $seen[$n] = $true
    $m = Get-Content (Join-Path $wsPkgs[$n] 'package.json') -Raw | ConvertFrom-Json
    @($m.dependencies.PSObject.Properties.Name) + @($m.peerDependencies.PSObject.Properties.Name) |
        Where-Object { $_ -and $wsPkgs.ContainsKey($_) -and -not $seen.ContainsKey($_) } |
        ForEach-Object { $need.Enqueue($_) }
}
$restored = 0
foreach ($n in $seen.Keys) {
    if (-not (Test-Path (Join-Path $deployNm $n))) {
        Copy-Item $wsPkgs[$n] (Join-Path $deployNm $n) -Recurse
        $restored++
    }
}
Step "恢复 $restored 个漏装包（闭包共 $($seen.Count) 个 workspace 包）"
Step '修正：vendor 链接实体化（link: overrides 部署为树外链接，必须换实体拷贝）'
foreach ($name in @('cosmokit', 'schemastery')) {
    $dst = Join-Path $deployNm "@deepseek-ai\$name"
    Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $stage "vendor\$name") $dst -Recurse -Force
}
# 与上游 materializeStagedLinks 同口径：workspace 包被部署为指回 staging 的链接，staging 删除后即失效。
# 逐链接换实体拷贝（跳过嵌套 node_modules，保住根上的单例）；`.bin` 整目录丢弃；指回部署根自身的链接直接丢弃。
Step '修正：链接实体化（部署树的 workspace / vendor 链接换实体拷贝）'
$payload = [System.IO.Path]::GetFullPath($deploy)
$materialized = 0
for ($pass = 0; $pass -lt 10; $pass++) {
    $links = @(Get-ChildItem $deployNm -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
    if ($links.Count -eq 0) { break }
    foreach ($link in $links) {
        $segments = $link.FullName.Substring($deployNm.Length + 1).Split([System.IO.Path]::DirectorySeparatorChar)
        $binIndex = [Array]::IndexOf($segments, '.bin')
        if ($binIndex -ge 0) {
            $binDir = Join-Path $deployNm (($segments[0..$binIndex]) -join '\')
            Remove-Item -Recurse -Force $binDir -ErrorAction SilentlyContinue
            $materialized++
            continue
        }
        $target = $link.ResolveLinkTarget($true)
        if (-not $target -or -not $target.Exists) { throw "链接目标不存在：$($link.FullName)" }
        if ($payload -eq $target.FullName -or $payload.StartsWith($target.FullName + '\')) {
            if ($link.PSIsContainer) { [System.IO.Directory]::Delete($link.FullName) } else { [System.IO.File]::Delete($link.FullName) }
        } elseif ($target -is [System.IO.DirectoryInfo]) {
            [System.IO.Directory]::Delete($link.FullName)
            robocopy $target.FullName $link.FullName /E /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "链接实体化失败：$($link.FullName)（robocopy $LASTEXITCODE）" }
        } else {
            [System.IO.File]::Delete($link.FullName)
            Copy-Item -LiteralPath $target.FullName -Destination $link.FullName -Force
        }
        $materialized++
    }
}
$leftLinks = @(Get-ChildItem $deploy -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
if ($leftLinks.Count -gt 0) { throw "部署树仍残留 $($leftLinks.Count) 个链接：$($leftLinks.FullName -join '; ')" }
Step "实体化 $materialized 个链接（部署树已无链接）"

# ---------- 4. node 便携版（dsh lock 锁定版本 + sha256 校验） ----------
Step "node v$nodeVersion"
New-Item -ItemType Directory -Force $CacheDir | Out-Null
$nodeZip = Join-Path $CacheDir "node-v$nodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
    # 官方源直连失败时回落 npmmirror 镜像（同一份官方 zip）
    $url = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
    Step "下载 $url"
    try { Invoke-WebRequest -Uri $url -OutFile $nodeZip }
    catch {
        $mirror = "https://npmmirror.com/mirrors/node/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
        Step "官方源失败，回落镜像 $mirror"
        Invoke-WebRequest -Uri $mirror -OutFile $nodeZip
    }
}
$actual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $nodeSha256) { throw "node zip sha256 不符：期望 $nodeSha256 实得 $actual" }
$nodeStage = Join-Path $env:TEMP ('worldsea-node-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Expand-Archive $nodeZip $nodeStage
$nodeExeSrc = Join-Path (Get-ChildItem $nodeStage -Directory | Select-Object -First 1).FullName 'node.exe'

# ---------- 5. 组装产物 ----------
Step "组装产物 -> $OutDir"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force (Join-Path $OutDir 'node') | Out-Null
Copy-Item $nodeExeSrc (Join-Path $OutDir 'node\node.exe')
Copy-Item (Join-Path (Get-ChildItem $nodeStage -Directory | Select-Object -First 1).FullName 'LICENSE') (Join-Path $OutDir 'node\LICENSE') -ErrorAction SilentlyContinue
robocopy $deploy (Join-Path $OutDir 'dsh') /E /MT:16 /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "复制部署树失败：robocopy $LASTEXITCODE" }
# overlay 随产物分发（壳 spawn 时 --patch 指向它；dev 口径 = 仓根 apps/tauri/dsh-overlay.yml）
Copy-Item (Join-Path $repo 'apps\tauri\dsh-overlay.yml') (Join-Path $OutDir 'overlay.yml')
Remove-Item -Recurse -Force $stage, $deploy, $nodeStage -ErrorAction SilentlyContinue
$size = [math]::Round(((Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Step "产物体积 $size MB"
# 压缩包 = 安装器 payload 的分发形态（安装器内嵌后用系统 tar.exe 解压；zip 内含 dsh-runtime/ 顶层目录前缀）
$zipPath = "$OutDir.zip"
Step "压缩 -> $zipPath"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
# .NET ZipFile 比 Compress-Archive 快；includeBaseDirectory = 产物顶层保留 dsh-runtime/ 前缀（安装器按此解压）
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $OutDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Step "压缩包体积 $zipSize MB"

# ---------- 6. 烟测：干净 DSH_HOME 启动 web + token 探测 ----------
if (-not $SkipSmoke) {
    Step '烟测（干净 DSH_HOME）'
    $smokeHome = Join-Path $env:TEMP ('worldsea-dsh-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $port = ((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Measure-Object -Maximum).Maximum) + 1
    $bin = Join-Path $OutDir 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
    $log = Join-Path $env:TEMP 'worldsea-dsh-smoke.log'
    $env:DSH_HOME = $smokeHome
    $proc = Start-Process -FilePath (Join-Path $OutDir 'node\node.exe') -ArgumentList "`"$bin`" web --no-open --port $port" -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden
    try {
        $ok = $false; $tokenLine = $null
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            if ($proc.HasExited) { throw "dsh web 提前退出（code=$($proc.ExitCode)）：$(Get-Content $log -ErrorAction SilentlyContinue | Select-Object -First 5)" }
            $tokenLine = Get-Content $log -ErrorAction SilentlyContinue | Select-String 'token=([\w-]+)' | Select-Object -First 1
            if ($tokenLine) {
                $token = $tokenLine.Matches[0].Groups[1].Value
                try {
                    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/?token=$token" -UseBasicParsing -TimeoutSec 3
                    if ($r.StatusCode -eq 200) { $ok = $true; break }
                } catch { }
            }
        }
        if (-not $ok) { throw "烟测未通过（40 轮探测失败）" }
        Step '烟测通过（web 200）'
    } finally {
        if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item -Recurse -Force $smokeHome -ErrorAction SilentlyContinue
    }
}
Step '完成'
