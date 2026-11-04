$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
if (-not (Test-Path 'dist/index.js')) { throw 'Build tidak ditemukan. Jalankan npm run build terlebih dahulu.' }
node 'dist/index.js'
