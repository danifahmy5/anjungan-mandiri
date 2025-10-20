<# 
  windows.ps1
  Tujuan:
    1) Pastikan Node.js v22.20.x terpasang (kalau belum → install 22.20.0)
    2) Pastikan pm2 terpasang global
    3) npm install di jkn-fp-bot-main & node-print-server
    4) Jalankan keduanya di pm2 + set autostart
#>

param(
  [string]$RequiredNodeVersion = "22.20.0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Membuka ulang PowerShell sebagai Administrator..."
    Start-Process -FilePath "pwsh" -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
  }
}

function Refresh-Path {
  # sinkron PATH current process dgn PATH machine + user (agar npm/node/pm2 langsung kebaca)
  $m = [Environment]::GetEnvironmentVariable("Path","Machine")
  $u = [Environment]::GetEnvironmentVariable("Path","User")
  $env:Path = ($m,$u) -join ";"
}

function Get-NodeVersion {
  try {
    $v = (node -v).Trim()  # e.g. "v22.20.0"
    if ($v -match '^v?(\d+\.\d+\.\d+)$') { return $Matches[1] }
  } catch { }
  return $null
}

function Test-NodeIsRequired {
  param([string]$current,[string]$required)
  if (-not $current) { return $false }
  # terima semua patch 22.20.x
  if ($current -match '^22\.20\.\d+$') { return $true }
  return $false
}

function Install-Node {
  param([string]$version)
  Write-Host "Menginstal Node.js v$version ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
  $url  = "https://nodejs.org/dist/v$version/node-v$version-$arch.msi"
  $msi  = Join-Path $env:TEMP "node-v$version-$arch.msi"

  try {
    # Coba winget dulu (jika versi tersedia)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Host "Mencoba instal via winget..."
      winget install -e --id OpenJS.NodeJS --version $version -h `
        --accept-source-agreements --accept-package-agreements
    } else {
      throw "winget tidak tersedia"
    }
  } catch {
    Write-Host "winget gagal/versi tidak tersedia, fallback ke MSI resmi..."
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  }

  Refresh-Path
}

function Ensure-PM2 {
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "Menginstal pm2 global..."
    npm install -g pm2
    Refresh-Path
  }
}

function NpmInstall-In {
  param([string]$dir)
  if (-not (Test-Path $dir)) {
    throw "Folder tidak ditemukan: $dir"
  }
  Push-Location $dir
  try {
    if (Test-Path "package-lock.json") {
      Write-Host "npm ci di $dir"
      npm ci
    } else {
      Write-Host "npm install di $dir"
      npm install
    }
  } finally {
    Pop-Location
  }
}

function PM2-StartOrRestart {
  param([string]$fullScript,[string]$name)
  if (-not (Test-Path $fullScript)) {
    throw "File tidak ditemukan: $fullScript"
  }
  $exists = (pm2 jlist | ConvertFrom-Json) | Where-Object { $_.name -eq $name }
  if ($exists) {
    Write-Host "pm2 restart $name"
    pm2 restart $name --update-env | Out-Null
  } else {
    Write-Host "pm2 start $fullScript --name $name"
    pm2 start $fullScript --name $name --time | Out-Null
  }
}

try {
  Ensure-Admin
  # Base dir = folder skrip ini (…/anjungan-mandiri)
  $BASE_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
  $JKN_DIR  = Join-Path $BASE_DIR "jkn-fp-bot-main"
  $PRN_DIR  = Join-Path $BASE_DIR "node-print-server"

  Write-Host "Base dir: $BASE_DIR"

  Refresh-Path
  $currentNode = Get-NodeVersion
  if (-not (Test-NodeIsRequired -current $currentNode -required $RequiredNodeVersion)) {
    Write-Host "Node saat ini: $($currentNode ?? 'tidak terpasang / versi lain'), butuh 22.20.x"
    Install-Node -version $RequiredNodeVersion
    $currentNode = Get-NodeVersion
    if (-not (Test-NodeIsRequired -current $currentNode -required $RequiredNodeVersion)) {
      throw "Gagal memastikan Node.js v22.20.x terpasang. Versi sekarang: $currentNode"
    }
  } else {
    Write-Host "Node OK: v$currentNode"
  }

  Ensure-PM2

  Write-Host "Menjalankan instalasi dependency…"
  NpmInstall-In -dir $JKN_DIR
  NpmInstall-In -dir $PRN_DIR

  Write-Host "Menjalankan apps dengan pm2…"
  PM2-StartOrRestart -fullScript (Join-Path $JKN_DIR "index.js") -name "jkn-fp-bot-main"
  PM2-StartOrRestart -fullScript (Join-Path $PRN_DIR "server.js") -name "node-print-server"

  Write-Host "Mengaktifkan autostart pm2…"
  pm2 startup windows -u $env:UserName --hp $HOME | Out-Host
  pm2 save | Out-Null

  Write-Host "`nSelesai ✅"
  pm2 status
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

