# Probe CDP endpoints on port 9222
Write-Host "=== Probing CDP endpoints ==="
$endpoints = @("/json/version", "/json", "/json/list", "/json/protocol", "/", "/json/0")
foreach ($ep in $endpoints) {
    $url = "http://localhost:9222$ep"
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        Write-Host "[OK $r.StatusCode] $url"
        $body = $r.Content
        if ($body.Length -gt 500) { $body = $body.Substring(0, 500) + "..." }
        Write-Host $body
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "[FAIL $code] $url : $($_.Exception.Message)"
    }
    Write-Host "---"
}
