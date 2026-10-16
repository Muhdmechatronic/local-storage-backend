# ==============================================================================
# Follow every NO-Docker service log at once (backend, minio, nginx, ngrok).
# Each line is prefixed with its service name. Ctrl+C to stop.
# ==============================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir   = Join-Path $ScriptDir "logs"
$ToolsDir  = Join-Path $ScriptDir "tools"
$Tail      = 50

$sources = [ordered]@{
    "backend"      = @{ Path = Join-Path $LogsDir "backend.log"; Color = "Cyan" }
    "minio"        = @{ Path = Join-Path $LogsDir "minio.log";   Color = "Magenta" }
    "nginx"        = @{ Path = Join-Path $LogsDir "nginx.log";   Color = "Green" }
    "ngrok"        = @{ Path = Join-Path $LogsDir "ngrok.log";   Color = "Yellow" }
}

# nginx writes its own error log under its install prefix (tools\nginx-<ver>\logs)
$nginxDir = Get-ChildItem -Path $ToolsDir -Directory -Filter "nginx-*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nginxDir) {
    $sources["nginx-error"] = @{ Path = Join-Path $nginxDir.FullName "logs\error.log"; Color = "Red" }
}

$width = ($sources.Keys | Measure-Object -Property Length -Maximum).Maximum

function Write-LogLine($Name, $Color, $Line) {
    $tag = "[" + $Name.PadRight($width) + "]"
    if ($Line -match '(?i)\b(error|fail|exception|fatal)\b') {
        Write-Host "$tag $Line" -ForegroundColor Red
    } else {
        Write-Host $tag -ForegroundColor $Color -NoNewline
        Write-Host " $Line"
    }
}

function Read-NewLines($Src) {
    if (-not (Test-Path $Src.Path)) { return @() }
    $len = (Get-Item $Src.Path).Length
    if ($len -lt $Src.Pos) { $Src.Pos = 0 }   # file was truncated / recreated
    if ($len -eq $Src.Pos) { return @() }
    try {
        $fs = [System.IO.File]::Open($Src.Path, 'Open', 'Read', 'ReadWrite, Delete')
        $fs.Seek($Src.Pos, 'Begin') | Out-Null
        $reader = New-Object System.IO.StreamReader($fs)
        $text = $reader.ReadToEnd()
        $Src.Pos = $fs.Position
        $reader.Close()
    } catch { return @() }
    # keep an unfinished last line for the next poll
    $text = $Src.Partial + $text
    $lines = $text -split "`r?`n"
    $Src.Partial = $lines[-1]
    if ($lines.Count -le 1) { return @() }
    return $lines[0..($lines.Count - 2)] | Where-Object { $_ -ne "" }
}

# Initial tail of each file
foreach ($name in $sources.Keys) {
    $src = $sources[$name]
    $src.Partial = ""
    if (Test-Path $src.Path) {
        Get-Content -Path $src.Path -Tail $Tail -ErrorAction SilentlyContinue |
            ForEach-Object { Write-LogLine $name $src.Color $_ }
        $src.Pos = (Get-Item $src.Path).Length
    } else {
        Write-Host "[$($name.PadRight($width))] (no log yet: $($src.Path))" -ForegroundColor DarkGray
        $src.Pos = 0
    }
}

Write-Host "`n------------------------- live -------------------------`n" -ForegroundColor DarkGray

while ($true) {
    foreach ($name in $sources.Keys) {
        $src = $sources[$name]
        foreach ($line in (Read-NewLines $src)) { Write-LogLine $name $src.Color $line }
    }
    Start-Sleep -Milliseconds 500
}
