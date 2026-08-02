# CDP 发送脚本：真实键盘输入 + Enter 发送，并捕获 console（15 秒）
$ErrorActionPreference = "Stop"
$list = Invoke-RestMethod http://localhost:9222/json/list
$page = $list | Where-Object { $_.type -eq "page" } | Select-Object -First 1
if (-not $page) { Write-Error "no page"; exit 1 }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$null = $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$cts = [Threading.CancellationTokenSource]::new()
$cts.CancelAfter([TimeSpan]::FromSeconds(20))

$msgId = 1000
function Send-Raw([string]$json) {
    $script:msgId++
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $seg = [ArraySegment[byte]]::new($bytes)
    $null = $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}
function Wait-Resp([int]$id) {
    $buf = New-Object byte[] 1048576
    $sb = [Text.StringBuilder]::new()
    while ($true) {
        $recv = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $null = $sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $recv.Count))
        $t = $sb.ToString()
        if ($t -match ('"id":' + $id + '\b')) { return $t }
    }
}

# 1. 聚焦 textarea
Send-Raw '{"id":1,"method":"Runtime.evaluate","params":{"expression":"document.querySelector(\"textarea.chat-textarea\")?.focus(); true","returnByValue":true}}'
$null = Wait-Resp 1
Start-Sleep -Milliseconds 300

# 2. 真实插入文本
Send-Raw '{"id":2,"method":"Input.insertText","params":{"text":"测试456"}}'
$null = Wait-Resp 2
Start-Sleep -Milliseconds 500

# 3. 开启日志捕获
Send-Raw '{"id":3,"method":"Runtime.enable"}'
$null = Wait-Resp 3
Send-Raw '{"id":4,"method":"Log.enable"}'
$null = Wait-Resp 4

# 4. Enter 发送
Send-Raw '{"id":5,"method":"Input.dispatchKeyEvent","params":{"type":"keyDown","key":"Enter","code":"Enter","windowsVirtualKeyCode":13,"nativeVirtualKeyCode":13}}'
$null = Wait-Resp 5
Send-Raw '{"id":6,"method":"Input.dispatchKeyEvent","params":{"type":"keyUp","key":"Enter","code":"Enter","windowsVirtualKeyCode":13,"nativeVirtualKeyCode":13}}'
$null = Wait-Resp 6

# 5. 收集 console 15 秒
$collected = [System.Collections.ArrayList]::new()
$buf = New-Object byte[] 2097152
$sb = [Text.StringBuilder]::new()
while ($true) {
    try {
        $recv = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
    } catch { break }
    $chunk = [Text.Encoding]::UTF8.GetString($buf, 0, $recv.Count)
    $null = $sb.Append($chunk)
    $text = $sb.ToString()
    $lines = $text -split "`n"
    for ($i = 0; $i -lt $lines.Length - 1; $i++) {
        $line = $lines[$i].Trim()
        if (-not $line) { continue }
        try { $evt = $line | ConvertFrom-Json } catch { continue }
        if ($evt.method -eq 'Runtime.consoleAPICalled') {
            $vals = @($evt.params.args | ForEach-Object { if ($_.value -ne $null) { $_.value } elseif ($_.description) { $_.description } else { '' } })
            $null = $collected.Add("CONSOLE[$($evt.params.type)]: $($vals -join ' ')")
        } elseif ($evt.method -eq 'Log.entryAdded') {
            $null = $collected.Add("LOG[$($evt.params.entry.level)]: $($evt.params.entry.text)")
        } elseif ($evt.method -eq 'Runtime.exceptionThrown') {
            $desc = ''
            if ($evt.params.exceptionDetails.exception) { $desc = $evt.params.exceptionDetails.exception.description }
            $null = $collected.Add("EXCEPTION: $($evt.params.exceptionDetails.text) $desc")
        }
    }
    if ($text -match "`n") { $null = $sb.Clear() }
}
$ws.Dispose()
if ($collected.Count -eq 0) { Write-Output "(no console output)" } else { $collected | ForEach-Object { Write-Output $_ } }
