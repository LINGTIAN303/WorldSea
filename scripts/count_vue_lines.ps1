$files = Get-ChildItem -Path src -Recurse -Filter *.vue
$results = @()
foreach ($f in $files) {
    $lines = (Get-Content $f.FullName | Measure-Object -Line).Lines
    if ($lines -gt 800) {
        $rel = $f.FullName.Replace((Get-Location).Path + '\', '')
        $results += [PSCustomObject]@{Lines = $lines; Path = $rel}
    }
}
$results | Sort-Object Lines -Descending | Format-Table -AutoSize
