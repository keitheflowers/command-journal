# Starts the Family Save Vector bridge on Windows (right-click -> Run with PowerShell).
# - Uses Node from PATH, or the copy inside Vector's Sparkstead folder.
# - Makes a private key the first time and shows it so you can paste it into the app.
# - Forwards the phone's requests to Ollama at 127.0.0.1:11434 and listens on port 8788.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    $sparkNode = Join-Path $env:USERPROFILE 'OneDrive\Documents\Codex\Sparkstead\runtime\node.exe'
    if (Test-Path -LiteralPath $sparkNode) { $node = $sparkNode }
}
if (-not $node) { throw 'Node.js was not found. Install it from https://nodejs.org (LTS) and run this again.' }

$keyDir = Join-Path $env:LOCALAPPDATA 'FamilySaveBridge'
$keyFile = Join-Path $keyDir 'key.txt'
if (-not (Test-Path -LiteralPath $keyFile)) {
    New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $newKey = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', ''
    Set-Content -LiteralPath $keyFile -Value $newKey -NoNewline
}
$env:VECTOR_KEY = (Get-Content -LiteralPath $keyFile -Raw).Trim()
if (-not $env:UPSTREAM) { $env:UPSTREAM = 'http://127.0.0.1:11434' }
if (-not $env:PORT) { $env:PORT = '8788' }

Write-Host ''
Write-Host 'Family Save -> Vector bridge' -ForegroundColor Cyan
Write-Host ('Key for the app (Settings -> Vector home server -> Key): ' + $env:VECTOR_KEY) -ForegroundColor Yellow
Write-Host 'Model to type in the app: vector-pilot:9b  (or vector-pilot:27b for harder questions)'
Write-Host 'Leave this window open while you use Vector from your phone.'
Write-Host ''
& $node (Join-Path $here 'server.js')
