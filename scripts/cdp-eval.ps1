# CDP 诊断脚本：通过 WebView2 的 CDP (9222) 执行 JS 表达式
# 用法: .\scripts\cdp-eval.ps1 "表达式"
param([Parameter(Mandatory=$true)][string]$Expr)

$ErrorActionPreference = "Stop"
$list = Invoke-RestMethod http://localhost:9222/json/list
$page = $list | Where-Object { $_.type -eq "page" } | Select-Object -First 1
if (-not $page) { Write-Error "未找到 page 目标"; exit 1 }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$null = $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

function Send-Cdp([string]$method, $params) {
    $id = Get-Random -Minimum 1000 -Maximum 99999
    $msg = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $seg = [ArraySegment[byte]]::new($bytes)
    $null = $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    # 等待响应
    $buf = New-Object byte[] 2097152
    $sb = [Text.StringBuilder]::new()
    while ($true) {
        $recv = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $null = $sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $recv.Count))
        $text = $sb.ToString()
        if ($text -match ('"id":' + $id + '\b')) { return $text }
        if ($text -match '^{"error"') { return $text }
    }
}

$resp = Send-Cdp "Runtime.evaluate" @{ expression = $Expr; returnByValue = $true; awaitPromise = $true }
$ws.Dispose()
$parsed = $resp | ConvertFrom-Json
if ($parsed.error) { Write-Output "CDP ERROR: $($parsed.error | ConvertTo-Json -Compress)"; exit 1 }
if ($parsed.result.exceptionDetails) {
    Write-Output "JS EXCEPTION: $($parsed.result.exceptionDetails.text): $($parsed.result.exceptionDetails.exception.description)"
    exit 1
}
Write-Output $parsed.result.result.value
