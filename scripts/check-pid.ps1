# Get details for PID 4344 and find webview processes
Write-Host "=== PID 4344 details ==="
Get-Process -Id 4344 -ErrorAction SilentlyContinue | Format-List Id, Name, Path, MainWindowTitle

Write-Host ""
Write-Host "=== WebView2 / WorldSmith processes ==="
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'msedgewebview2|worldsmith|tauri' -or $_.CommandLine -match 'worldsmith|9222'
} | ForEach-Object {
    Write-Host ("PID={0} PPID={1} Name={2}" -f $_.ProcessId, $_.ParentProcessId, $_.Name)
    Write-Host ("  CommandLine: {0}" -f $_.CommandLine)
    Write-Host ""
}

Write-Host ""
Write-Host "=== Check if 4344 has --remote-debugging-port in cmdline ==="
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=4344"
if ($proc) {
    Write-Host ("CmdLine: " + $proc.CommandLine)
}
