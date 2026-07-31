# Check various proxy settings
Write-Host "=== IE/Internet Settings Proxy ==="
$ie = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Write-Host "ProxyEnable: $($ie.ProxyEnable)"
Write-Host "ProxyServer: $($ie.ProxyServer)"
Write-Host "ProxyOverride: $($ie.ProxyOverride)"

Write-Host ""
Write-Host "=== WinHTTP Proxy ==="
$winhttp = netsh winhttp show proxy
$winhttp

Write-Host ""
Write-Host "=== Test direct connection to rsproxy.cn ==="
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("rsproxy.cn", 443)
    Write-Host "Direct TCP to rsproxy.cn:443 = OK"
    $tcp.Close()
} catch {
    Write-Host "Direct TCP to rsproxy.cn:443 = FAILED: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== Check if proxy software is running ==="
$proxyProcs = Get-Process | Where-Object { $_.ProcessName -match "clash|v2ray|trojan|shadowsocks|ssr|verge|nekoray|qv2ray|sing-box|mihomo" }
if ($proxyProcs) {
    $proxyProcs | Format-Table Id, ProcessName, Path -AutoSize
} else {
    Write-Host "No common proxy software detected"
}

Write-Host ""
Write-Host "=== Check port 8080 owner ==="
$conns = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($c in $conns) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        Write-Host "Port 8080 PID=$($c.OwningProcess) Name=$($p.ProcessName) State=$($c.State)"
    }
} else {
    Write-Host "Nothing listening on port 8080"
}
