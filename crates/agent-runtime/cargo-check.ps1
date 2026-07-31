$env:NO_PROXY = "*"
$env:no_proxy = "*"
Set-Location -LiteralPath "d:\本地化AI\DeepSeek_Home\worldsmith\crates\agent-runtime"
cargo check 2>&1 | Select-Object -Last 60
