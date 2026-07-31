$root = (Get-Location).Path
Get-ChildItem -Path "$root\src" -Filter '*.vue' -Recurse | ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    if ($lines -gt 800) {
        $rel = $_.FullName.Substring($root.Length + 1)
        [PSCustomObject]@{ Lines = $lines; Path = $rel }
    }
} | Sort-Object Lines -Descending | Format-Table -AutoSize
