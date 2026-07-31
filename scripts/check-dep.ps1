# Check if tracing-subscriber already in Cargo.lock
Write-Host "=== Search tracing-subscriber in Cargo.lock ==="
$lockFile = "d:\本地化AI\DeepSeek_Home\worldsmith\Cargo.lock"
if (-not (Test-Path $lockFile)) {
    Write-Host "Cargo.lock not found at $lockFile"
    exit 1
}

$content = Get-Content $lockFile -Raw
if ($content -match 'tracing-subscriber') {
    Write-Host "FOUND: tracing-subscriber already in Cargo.lock"
    $content -split "`n" | Select-String -Pattern "tracing-subscriber" -Context 0,2
} else {
    Write-Host "NOT FOUND: tracing-subscriber not in Cargo.lock"
}

Write-Host ""
Write-Host "=== Check registry cache ==="
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
$cacheDir = "$cargoHome\registry\src"
if (Test-Path $cacheDir) {
    Get-ChildItem -Path $cacheDir -Recurse -Directory -Filter "tracing-subscriber-*" -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
} else {
    Write-Host "No cache dir: $cacheDir"
}
