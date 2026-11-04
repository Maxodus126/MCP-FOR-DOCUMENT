$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host '=== Universal Document Reader MCP v3.0 Setup ===' -ForegroundColor Cyan
$node = node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js belum terpasang. Install Node.js 22 LTS terlebih dahulu.' }
$version = [version]($node.TrimStart('v'))
if ($version -lt [version]'20.19.0') { throw "Node.js $node terlalu lama. Minimum 20.19.0; direkomendasikan 22 LTS." }
Write-Host "Node.js $node terdeteksi." -ForegroundColor Green

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'File .env dibuat. Silakan sesuaikan ALLOWED_DIRS di Notepad, simpan, lalu tutup Notepad untuk melanjutkan.' -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList '.env' -Wait
}

Write-Host 'Memasang dependency dari npm...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install gagal. Periksa koneksi internet, proxy, registry npm, dan versi Node.js.' }

Write-Host 'Menjalankan typecheck, test, dan build...' -ForegroundColor Cyan
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Pemeriksaan gagal. Jangan hubungkan ke Claude Desktop sebelum error diperbaiki.' }

Write-Host 'Menjalankan doctor...' -ForegroundColor Cyan
npm run doctor
if ($LASTEXITCODE -ne 0) { throw 'Doctor gagal. Periksa ALLOWED_DIRS dan build.' }

Write-Host 'Setup selesai. Jalankan npm run smoke untuk menguji protokol MCP.' -ForegroundColor Green
