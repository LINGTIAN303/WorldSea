# CDP 诊断脚本 v3：hook console + 注入输入 + 收集原始流（ConvertTo-Json 安全转义）
# 用法: powershell -ExecutionPolicy Bypass -File scripts/cdp-diag.ps1
$ErrorActionPreference = "Stop"
$hookCode = Get-Content -Raw -Path (Join-Path $PSScriptRoot "diag-hook.js")
$focusExpr = 'const ta=document.querySelector("textarea.chat-textarea"); if(ta){ta.focus(); "focused"} else {"NOT_FOUND"}'
$readExpr = 'JSON.stringify({logs: window.__diagLogs || [], taValue: (document.querySelector("textarea.chat-textarea")||{}).value || null, bubbleCount: document.querySelectorAll("[class*=user], [class*=bubble], [class*=message]").length})'

Write-Output "[1] 获取页面列表..."
$list = Invoke-RestMethod http://localhost:9222/json/list -TimeoutSec 5
$page = $list | Where-Object { $_.type -eq "page" } | Select-Object -First 1
if (-not $page) { Write-Error "no page"; exit 1 }
Write-Output "[1] 页面: $($page.title)  url=$($page.url)"

Write-Output "[2] 连接 WebSocket..."
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$null = $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
Write-Output "[2] 已连接"

$cts = [Threading.CancellationTokenSource]::new()
$cts.CancelAfter([TimeSpan]::FromSeconds(35))

function Send-Json([hashtable]$obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 12
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $seg = [ArraySegment[byte]]::new($bytes)
    $null = $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Read-Chunk() {
    $buf = New-Object byte[] 2097152
    try {
        $recv = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
        return [Text.Encoding]::UTF8.GetString($buf, 0, $recv.Count)
    } catch {
        return $null
    }
}

Write-Output "[3] 注入 console hook..."
Send-Json @{ id = 1; method = "Runtime.enable" }
$null = Read-Chunk
Send-Json @{ id = 2; method = "Log.enable" }
$null = Read-Chunk
Send-Json @{ id = 3; method = "Runtime.evaluate"; params = @{ expression = $hookCode; returnByValue = $true } }
$null = Read-Chunk
Write-Output "[3] hook 完成"

Write-Output "[4] 聚焦输入框..."
Send-Json @{ id = 4; method = "Runtime.evaluate"; params = @{ expression = $focusExpr; returnByValue = $true } }
$null = Read-Chunk
Start-Sleep -Milliseconds 300

Write-Output "[5] 插入文本 + Enter..."
Send-Json @{ id = 5; method = "Input.insertText"; params = @{ text = "CDP诊断消息" } }
$null = Read-Chunk
Start-Sleep -Milliseconds 500
Send-Json @{ id = 6; method = "Input.dispatchKeyEvent"; params = @{ type = "keyDown"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } }
$null = Read-Chunk
Send-Json @{ id = 7; method = "Input.dispatchKeyEvent"; params = @{ type = "keyUp"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } }
$null = Read-Chunk
Write-Output "[5] 已发送，开始收集 25 秒..."

$collected = [System.Collections.ArrayList]::new()
$watchdog = [System.Diagnostics.Stopwatch]::StartNew()
while ($watchdog.Elapsed.TotalSeconds -lt 25) {
    $chunk = Read-Chunk
    if ($null -eq $chunk) { break }
    foreach ($line in ($chunk -split "`n")) {
        $line = $line.Trim()
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
        } elseif ($null -eq $evt.method -or $evt.id) {
            # 命令响应，忽略
        } else {
            $null = $collected.Add("OTHER[$($evt.method)]")
        }
    }
}

Write-Output "===== 收集结果（25s） ====="
if ($collected.Count -eq 0) { Write-Output "(无 console 输出)" } else { $collected | ForEach-Object { Write-Output $_ } }

Write-Output "===== 读取 __diagLogs ====="
Send-Json @{ id = 99; method = "Runtime.evaluate"; params = @{ expression = $readExpr; returnByValue = $true } }
$resp = Read-Chunk
if ($null -ne $resp) { Write-Output $resp }

$ws.Dispose()
Write-Output "[DONE]"
