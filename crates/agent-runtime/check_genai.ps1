$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath 'd:\本地化AI\DeepSeek_Home\worldsmith\crates\agent-runtime'
$env:RUST_BACKTRACE = '1'
$out = cargo check --features llm-genai 2>&1
$out | Select-String -Pattern 'NASM|error\[|panicked|\.asm|failed' -Context 0,3 | Select-Object -First 40
