# Check if CDP port 9222 is accessible
Write-Host "=== Checking CDP port 9222 ==="
try {
    $response = Invoke-WebRequest -Uri "http://localhost:9222/json/version" -UseBasicParsing -TimeoutSec 5
    Write-Host "CDP is available:"
    Write-Host $response.Content
} catch {
    Write-Host "CDP not available: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== Listing pages on CDP ==="
try {
    $response = Invoke-WebRequest -Uri "http://localhost:9222/json/list" -UseBasicParsing -TimeoutSec 5
    Write-Host "Pages:"
    Write-Host $response.Content
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}
