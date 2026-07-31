# Find and kill processes occupying port 5173
Write-Host "=== Find processes on port 5173 ==="
$conns = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($null -eq $conns) {
    Write-Host "Port 5173 is free"
} else {
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        Write-Host ("PID={0} Name={1} State={2}" -f $c.OwningProcess, $proc.ProcessName, $c.State)
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host ("Killed PID={0}" -f $c.OwningProcess)
    }
}

Write-Host ""
Write-Host "=== Also kill residual vite/tauri/node/cargo processes ==="
Get-Process -Name "node","cargo","WorldSmith" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("PID={0} Name={1}" -f $_.Id, $_.ProcessName)
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host ("Killed PID={0}" -f $_.Id)
}

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "=== Verify port 5173 is free ==="
$remain = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($null -eq $remain) {
    Write-Host "OK: 5173 is free now"
} else {
    Write-Host "WARN: 5173 still occupied"
    $remain | Format-Table
}
