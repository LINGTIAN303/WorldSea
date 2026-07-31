Write-Host "=== git global config (http section) ==="
git config --global --get-regexp "http|proxy" 2>&1

Write-Host ""
Write-Host "=== git system config ==="
git config --system --get-regexp "http|proxy" 2>&1

Write-Host ""
Write-Host "=== All .gitconfig files ==="
$gitConfig = "$env:USERPROFILE\.gitconfig"
if (Test-Path $gitConfig) {
    Write-Host "--- $gitConfig ---"
    Get-Content $gitConfig
}

Write-Host ""
Write-Host "=== Check for [http] in cargo configs ==="
$cargoConfigs = @(
    "$env:USERPROFILE\.cargo\config.toml",
    "$env:USERPROFILE\.cargo\config",
    "d:\本地化AI\DeepSeek_Home\worldsmith\.cargo\config.toml"
)
foreach ($cfg in $cargoConfigs) {
    if (Test-Path $cfg) {
        Write-Host "--- $cfg ---"
        Get-Content $cfg
    }
}
