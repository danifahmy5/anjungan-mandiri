# install.ps1 (Windows) - Simple & Robust
$ErrorActionPreference = 'Stop'

Write-Host "=== JKN FP BOT Installer (Windows) ===`n"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-ERR($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red }

try {
    # --- Lokasi proyek ---
    $ScriptPath = $PSCommandPath
    if (-not $ScriptPath) { $ScriptPath = $MyInvocation.MyCommand.Path }
    $ProjectDir = Split-Path -Parent $ScriptPath
    Set-Location -LiteralPath $ProjectDir
    Write-OK "Project dir : $ProjectDir"

    # --- Hilangkan warning unblock ---
    try { Unblock-File -LiteralPath $ScriptPath -ErrorAction SilentlyContinue } catch {}

    # --- Cek Node & npm ---
    Write-Step "Cek Node.js & npm"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js tidak ditemukan. Install Node.js (LTS) terlebih dahulu."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm tidak ditemukan. Pastikan instalasi Node.js menyertakan npm."
    }
    Write-Host ("Node : " + (node -v))
    Write-Host ("npm  : "  + (npm -v))

    # --- Install dependensi ---
    if (Test-Path -LiteralPath (Join-Path $ProjectDir 'package-lock.json')) {
        Write-Step "Menjalankan: npm ci"
        npm ci
    } else {
        Write-Step "Menjalankan: npm install"
        npm install
    }

    # --- Cari path PM2 yang valid ---
    function Find-PM2Path {
        $candidates = @()

        $cmd = Get-Command pm2 -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Path) { $candidates += $cmd.Path }

        # Lokasi global npm default pengguna
        $candidates += (Join-Path $env:APPDATA 'npm\pm2.cmd')
        $candidates += (Join-Path $env:APPDATA 'npm\pm2.exe')

        # Prefix npm (kalau diubah)
        try {
            $prefix = (& npm config get prefix 2>$null).Trim()
            if ($prefix) {
                $candidates += (Join-Path $prefix 'pm2.cmd')
                $candidates += (Join-Path $prefix 'pm2.exe')
                $candidates += (Join-Path $prefix 'bin\pm2.cmd')
            }
        } catch {}

        # Hapus null & duplikat, ambil yang ada
        foreach ($p in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
            if (Test-Path -LiteralPath $p) { return $p }
        }
        return $null
    }

    $pm2Path = Find-PM2Path
    if (-not $pm2Path) {
        Write-Step "PM2 belum ada. Install global: npm install -g pm2"
        npm install -g pm2
        $pm2Path = Find-PM2Path
    }
    if (-not $pm2Path) {
        throw "PM2 tetap tidak ditemukan. Tambahkan `%APPDATA%\npm` ke PATH user, lalu coba lagi."
    }

    # Pastikan direktori pm2 ada di PATH sesi ini (supaya 'pm2' bisa dipanggil langsung)
    $pm2Dir = Split-Path -Parent $pm2Path
    if ($env:Path -notmatch [regex]::Escape($pm2Dir)) {
        $env:Path = "$env:Path;$pm2Dir"
    }
    Write-OK ("PM2     : $pm2Path")
    Write-OK ("PM2 ver : " + (& "$pm2Path" -v))

    # --- Start via PM2 ---
    $pm2Name = 'jkn-fp-bot'
    $entryJs = Join-Path $ProjectDir 'index.js'
    if (-not (Test-Path -LiteralPath $entryJs)) {
        throw "Entry file tidak ditemukan: $entryJs"
    }

    Write-Step "pm2 start"
    & "$pm2Path" start $entryJs --name $pm2Name --node-args="--env-file=.env"

    Write-Step "pm2 save"
    & "$pm2Path" save --force

    # --- Auto-start saat login (Startup folder) ---
    $startupFolder = [Environment]::GetFolderPath('Startup')
    if (-not (Test-Path -LiteralPath $startupFolder)) {
        throw "Folder Startup tidak ditemukan: $startupFolder"
    }

    $batName = 'pm2-resurrect-jkn-fp-bot.bat'
    $batTemp = Join-Path $ProjectDir $batName
    $pm2Quoted = '"' + $pm2Path + '"'

    $batContent = @"
@echo off
REM Autostart PM2 and resurrect processes for $pm2Name
setlocal
timeout /t 5 /nobreak >nul
call $pm2Quoted resurrect
endlocal
"@
    Set-Content -LiteralPath $batTemp -Value $batContent -Encoding ASCII

    Write-Step "Pindah file Startup"
    Move-Item -LiteralPath $batTemp -Destination $startupFolder -Force

    # --- Ringkasan ---
    Write-Host ""
    Write-OK "Setup selesai."
    & "$pm2Path" list

    Write-Host "`nAplikasi akan otomatis hidup kembali saat login (Startup -> pm2 resurrect)."
    Write-Host "Jika ingin melihat log: pm2 logs $pm2Name --lines 200"
    Write-Host ""
}
catch {
    $msg = try { $_.Exception.Message } catch { ($_ | Out-String) }
    Write-ERR $msg
    Write-Host ""
    Write-Host "Tips:"
    Write-Host "- Pastikan pm2 ada di %APPDATA%\npm (mis. C:\Users\<user>\AppData\Roaming\npm\pm2.cmd)"
    Write-Host "- Jika 'pm2' belum dikenal di terminal, tambahkan folder di atas ke PATH User."
    exit 1
}
