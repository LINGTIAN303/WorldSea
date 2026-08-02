# CDP 监听脚本：捕获 WebView2 页面 console 日志（默认 20 秒）
# 用法: .\scripts\cdp-listen.ps1 [-Seconds 20]
param([int]$Seconds = 20)

$ErrorActionPreference = "Stop"
$list = Invoke-RestMethod http://localhost:9222/json/list
$page = $list | Where-Object { $_.type -eq "page" } | Select-Object -First 1
if (-not $page) { Write-Error "未找到 page 目标"; exit 1 }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$null = $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$cts = [Threading.CancellationTokenSource]::new()
$cts.CancelAfter([TimeSpan]::FromSeconds($Seconds))

$msgId = 1000
function Send-Raw([string]$json) {
    $script:msgId++
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $seg = [ArraySegment[byte]]::new($bytes)
    $null = $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

# 开启 Runtime + Log 域
Send-Raw '{"id":1,"method":"Runtime.enable"}'
Send-Raw '{"id":2,"method":"Log.enable"}'
Start-Sleep -Milliseconds 500

$collected = [System.Collections.ArrayList]::new()
$buf = New-Object byte[] 2097152
$sb = [Text.StringBuilder]::new()

while ($true) {
    try {
        $recv = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
    } catch {
        break # 超时结束
    }
    if ($recv.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { break }
    $chunk = [Text.Encoding]::UTF8.GetString($buf, 0, $recv.Count)
    # 尝试逐条解析（可能有半包）
    $sb.Append($chunk) | Out-Null
    $text = $sb.ToString()
    $lines = $text -split "`n"
    for ($i = 0; $i -lt $lines.Length - 1; $i++) {
        $line = $lines[$i].Trim()
        if (-not $line) { continue }
        try {
            $evt = $line | ConvertFrom-Json
        } catch { continue }
        $method = $evt.method
        if ($method -eq 'Runtime.consoleAPICalled') {
            $args = @($evt.params.args | ForEach-Object { $_.value -or $_.description -or ($_.type + ':' + ($_.value | ConvertTo-Json -Compress)) })
            $null = $collected.Add("CONSOLE[$($evt.params.type)]: $($args -join ' ')".Trim())
        } elseif ($method -eq 'Log.entryAdded') {
            $entry = $evt.params.entry
            $null = $collected.Add("LOG[$($entry.level)]: $($entry.text)")
        } elseif ($method -eq 'Runtime.exceptionThrown') {
            $desc = ''
            if ($evt.params.exceptionDetails.exception) { $desc = $evt.params.exceptionDetails.exception.description }
            $null = $collected.Add("EXCEPTION: $($evt.params.exceptionDetails.text) $desc")
        }
    }
    if ($text -match "`n") { $null = $sb.Clear() }
}

$ws.Dispose()
if ($collected.Count -eq 0) { Write-Output "(无 console 输出)" } else { $collected | ForEach-Object { Write-Output $_ } }
