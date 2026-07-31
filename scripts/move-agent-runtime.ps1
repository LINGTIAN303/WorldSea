$src = "d:\本地化AI\DeepSeek_Home\worldsmith\worldsmith-agent\src"
$dst = "d:\本地化AI\DeepSeek_Home\worldsmith\packages\agent-runtime\src"

# 创建目标 execution 目录
New-Item -ItemType Directory -Force -Path "$dst\execution" | Out-Null

# 移动端无关目录
$dirs = @("tools","skills","session","orchestrator","toolbus","providers","context","kb","embedding","group-chat","mcp","stores","utils","__tests__")
foreach ($d in $dirs) {
  if (Test-Path "$src\$d") {
    Move-Item -Path "$src\$d" -Destination "$dst\$d" -Force
    Write-Host "Moved dir: $d"
  }
}

# 移动端无关根文件
$files = @("agent.ts","bridge.ts","bridge-types.ts","governor.ts","governor-modules.ts","vite-env.d.ts")
foreach ($f in $files) {
  if (Test-Path "$src\$f") {
    Move-Item -Path "$src\$f" -Destination "$dst\$f" -Force
    Write-Host "Moved file: $f"
  }
}

# 移动 execution/adapter.ts 和 execution/env.ts（保留 node-adapter/tauri-adapter/ws-adapter）
Move-Item -Path "$src\execution\adapter.ts" -Destination "$dst\execution\adapter.ts" -Force
Write-Host "Moved: execution/adapter.ts"
Move-Item -Path "$src\execution\env.ts" -Destination "$dst\execution\env.ts" -Force
Write-Host "Moved: execution/env.ts"

Write-Host "`n=== Remaining in worldsmith-agent/src ==="
Get-ChildItem -Path $src -Recurse -File | Select-Object -ExpandProperty FullName
