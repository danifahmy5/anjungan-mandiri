<# windows.ps1 (PS 5.1 compatible, robust logging, no Transcript) #>

param(
  [string]$RequiredNodeVersion = "22.20.0",
  [switch]$NoPauseAtEnd
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Paths & log
$BASE_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir   = Join-Path $BASE_DIR "install-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile  = Join-Path $LogDir ("windows-install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

function Log-Header {
  @"
=== anjungan-mandiri/windows.ps1 ===
Time   : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Base   : $BASE_DIR
Log    : $LogFile
====================================
"@ | Out-File -FilePath $LogFile -Encoding UTF8
}

function Pause-End([int]$Code=0){
  Write-Host "`nLog file: $LogFile"
  if (-not $NoPauseAtEnd) { Read-Host "Selesai. Tekan ENTER untuk menutup" | Out-Null }
  exit $Code
}

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Membuka ulang PowerShell sebagai Administrator..."
    $hostExe = if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { "pwsh.exe" } else { "powershell.exe" }
    Start-Process -FilePath $hostExe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Pause-End
  }
}

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable("Path","Machine")
  $u = [Environment]::GetEnvironmentVariable("Path","User")
  if ($m -and $u) { $env:Path = "$m;$u" }
  elseif ($m) { $env:Path = $m }
  elseif ($u) { $env:Path = $u }
}

# Jalankan command eksternal via cmd dan append log; fail jika exitcode != 0
function Run-Cmd {
  param([Parameter(Mandatory)][string]$CmdLine)
  Write-Host "→ $CmdLine"
  $args = "/c $CmdLine >> `"$LogFile`" 2>&1"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList $args -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Perintah gagal (ExitCode=$($p.ExitCode)): $CmdLine (lihat log: $LogFile)" }
}

function Get-NodeVersion {
  try {
    $v = (node -v).Trim()  # e.g. v22.20.0
    if ($v -match '^v?(\d+\.\d+\.\d+)$') { return $Matches[1] }
  } catch { }
  return $null
}
function Test-NodeIsRequired([string]$current,[string]$required){
  if (-not $current) { return $false }
  return ($current -match '^22\.20\.\d+$')  # any 22.20.x
}

function Install-Node([string]$version){
  Write-Host "Menginstal Node.js v$version ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
  $url  = "https://nodejs.org/dist/v$version/node-v$version-$arch.msi"
  $msi  = Join-Path $env:TEMP "node-v$version-$arch.msi"

  $wingetAvailable = $false
  try { if (Get-Command winget -ErrorAction SilentlyContinue) { $wingetAvailable = $true } } catch { }

  if ($wingetAvailable) {
    try {
      Run-Cmd 'winget install -e --id OpenJS.NodeJS --accept-source-agreements --accept-package-agreements --silent --version '"$version"
    } catch {
      Write-Host "winget gagal/versi tidak tersedia, fallback ke MSI resmi..."
      Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    }
  } else {
    Write-Host "winget tidak tersedia, gunakan MSI resmi..."
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  }
  Refresh-Path
}

function Ensure-NpmUserPrefix {
  # Hindari prefix global ke Program Files saat run as Admin
  $desired = Join-Path $env:APPDATA "npm"
  try { $current = (npm config get prefix) 2>$null } catch { $current = $null }
  if (-not $current -or $current -match 'Program Files') {
    Write-Host "Menyetel npm global prefix ke: $desired"
    Run-Cmd ("npm config set prefix `"$desired`" --global")
    # persist PATH user (untuk sesi baru)
    $userPath = [Environment]::GetEnvironmentVariable("Path","User")
    if ($userPath -notmatch [Regex]::Escape($desired)) {
      [Environment]::SetEnvironmentVariable("Path", ($userPath + ";" + $desired), "User")
    }
    # untuk sesi saat ini
    if ($env:Path -notmatch [Regex]::Escape($desired)) {
      $env:Path = "$desired;$env:Path"
    }
    # juga set var env agar npm hormati prefix ini
    [Environment]::SetEnvironmentVariable("NPM_CONFIG_PREFIX", $desired, "User")
    $env:NPM_CONFIG_PREFIX = $desired
    Refresh-Path
  }
}

function Ensure-PM2 {
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "Menginstal pm2 global (tunggu)..."
    Ensure-NpmUserPrefix
    Run-Cmd "npm install -g pm2 --no-audit --no-fund --loglevel=error"
    Refresh-Path
    if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
      throw "pm2 tidak ditemukan setelah instalasi. Cek log: $LogFile"
    }
  } else {
    Write-Host "pm2 sudah terpasang."
  }
}

function NpmInstall-In([string]$dir){
  if (-not (Test-Path $dir)) { throw "Folder tidak ditemukan: $dir" }
  if (Test-Path (Join-Path $dir "package-lock.json")) {
    Write-Host "npm ci di $dir"
    Run-Cmd "pushd `"$dir`" && npm ci && popd"
  } else {
    Write-Host "npm install di $dir"
    Run-Cmd "pushd `"$dir`" && npm install && popd"
  }
}

function PM2-StartOrRestart([string]$fullScript,[string]$name){
  if (-not (Test-Path $fullScript)) { throw "File tidak ditemukan: $fullScript" }
  # cek ada/tidak
  $exists = $false
  try {
    $json = pm2 jlist | Out-String
    if ($json -and $json.Trim().StartsWith("[")) {
      $list = $json | ConvertFrom-Json
      if ($list) { $exists = @($list | Where-Object { $_.name -eq $name }).Count -gt 0 }
    }
  } catch {
    $exists = (pm2 list | Select-String -SimpleMatch $name) -ne $null
  }
  if ($exists) {
    Run-Cmd "pm2 restart `"$name`" --update-env"
  } else {
    Run-Cmd "pm2 start `"$fullScript`" --name `"$name`" --time"
  }
}

# ===== MAIN =====
try {
  Log-Header
  Ensure-Admin

  $JKN_DIR = Join-Path $BASE_DIR "jkn-fp-bot-main"
  $PRN_DIR = Join-Path $BASE_DIR "node-print-server"

  Write-Host "Base dir: $BASE_DIR"
  Refresh-Path

  $currentNode = Get-NodeVersion
  $nodeDisplay = if ($currentNode) { $currentNode } else { "tidak terpasang / versi lain" }

  if (-not (Test-NodeIsRequired $currentNode $RequiredNodeVersion)) {
    Write-Host "Node saat ini: $nodeDisplay, butuh 22.20.x"
    Install-Node $RequiredNodeVersion
    $currentNode = Get-NodeVersion
    if (-not (Test-NodeIsRequired $currentNode $RequiredNodeVersion)) {
      throw "Gagal memastikan Node.js v22.20.x terpasang. Versi sekarang: $currentNode"
    }
  } else {
    Write-Host "Node OK: v$currentNode"
  }

  Ensure-PM2

  Write-Host "Menjalankan instalasi dependency…"
  NpmInstall-In $JKN_DIR
  NpmInstall-In $PRN_DIR
  Write-Host $PRN_DIR

  Write-Host "Menjalankan apps dengan pm2…"
  PM2-StartOrRestart (Join-Path $JKN_DIR "index.js") "jkn-fp-bot-main"
  PM2-StartOrRestart (Join-Path $PRN_DIR "server.js") "node-print-server"

  Write-Host "Mengaktifkan autostart pm2…"
  Run-Cmd ("pm2 startup windows -u " + $env:UserName + " --hp `"$HOME`"")
  Run-Cmd "pm2 save"

  Write-Host "`nSelesai ✅"
  pm2 status
  "`n=== Tail 50 baris terakhir log instalasi ===" | Add-Content -Path $LogFile
  Get-Content -Path $LogFile -Tail 50
  Pause-End 0
}
catch {
  Write-Host ""
  Write-Host "FATAL: $($_ | Out-String)"
  Pause-End 1
}
