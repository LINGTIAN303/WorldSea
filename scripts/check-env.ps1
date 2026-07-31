# Check CARGO/HTTP related env vars at User and Machine level
Write-Host "=== User environment variables ==="
$userVars = [System.Environment]::GetEnvironmentVariables("User")
foreach ($key in $userVars.Keys) {
    if ($key -match "CARGO|PROXY|HTTP|HTTPS|ALL_PROXY|NO_PROXY|RUSTUP") {
        Write-Host "$key = $($userVars[$key])"
    }
}

Write-Host ""
Write-Host "=== Machine environment variables ==="
$machineVars = [System.Environment]::GetEnvironmentVariables("Machine")
foreach ($key in $machineVars.Keys) {
    if ($key -match "CARGO|PROXY|HTTP|HTTPS|ALL_PROXY|NO_PROXY|RUSTUP") {
        Write-Host "$key = $($machineVars[$key])"
    }
}

Write-Host ""
Write-Host "=== Process environment variables ==="
$procVars = [System.Environment]::GetEnvironmentVariables("Process")
foreach ($key in $procVars.Keys) {
    if ($key -match "CARGO|PROXY|HTTP|HTTPS|ALL_PROXY|NO_PROXY|RUSTUP") {
        Write-Host "$key = $($procVars[$key])"
    }
}

Write-Host ""
Write-Host "=== All .cargo config files ==="
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
Get-ChildItem -Path $cargoHome -Filter "config*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "--- $($_.FullName) ---"
    Get-Content $_.FullName
}
