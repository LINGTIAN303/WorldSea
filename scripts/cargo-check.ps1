$env:CARGO_HTTP_PROXY = ""
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""
$env:all_proxy = ""
Remove-Item Env:ICUBE_PROXY_HOST -ErrorAction SilentlyContinue

Write-Host "=== Running cargo check ==="
cargo check --message-format=short 2>&1 | Select-Object -Last 80
