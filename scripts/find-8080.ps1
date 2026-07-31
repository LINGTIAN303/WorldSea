# Find any env var containing 8080
Write-Host "=== All env vars containing 8080 ==="
$all = [System.Environment]::GetEnvironmentVariables("Process")
foreach ($key in $all.Keys) {
    $val = "$($all[$key])"
    if ($val -match "8080") {
        Write-Host "$key = $val"
    }
}

Write-Host ""
Write-Host "=== All env vars containing ICUBE ==="
foreach ($key in $all.Keys) {
    if ($key -match "ICUBE|PROXY|TRAE") {
        Write-Host "$key = $($all[$key])"
    }
}

Write-Host ""
Write-Host "=== Test curl direct to rsproxy.cn ==="
try {
    $r = curl.exe -sS -o NUL -w "HTTP %{http_code} time=%{time_total}s`n" --max-time 8 "https://rsproxy.cn/index/config.json" 2>&1
    Write-Host "curl result: $r"
} catch {
    Write-Host "curl failed: $($_.Exception.Message)"
}
