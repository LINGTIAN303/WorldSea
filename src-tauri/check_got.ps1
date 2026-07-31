$env:NO_PROXY = '*'
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
Set-Location -LiteralPath 'd:\本地化AI\DeepSeek_Home\worldsmith\src-tauri'
cargo check --message-format=short 2>&1 | Select-Object -Last 80
