@echo off
REM ============================================
REM  Anjungan Mandiri Chrome Autostart Script
REM  Kompatibel: Windows 10 & 11 (Home, Pro)
REM  Jalankan via Task Scheduler (At Startup)
REM ============================================

REM --- GANTI URL DI BAWAH INI SESUAI APLIKASI ANDA ---
set URL=http://localhost:8000/display/doctor-queue

REM --- LOKASI DEFAULT GOOGLE CHROME (64-bit & 32-bit) ---
set CHROME1="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME2="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

REM --- CEK CHROME ADA DI MANA ---
if exist %CHROME1% (
    set CHROME=%CHROME1%
) else if exist %CHROME2% (
    set CHROME=%CHROME2%
) else (
    echo [ERROR] Google Chrome tidak ditemukan!
    pause
    exit /b
)

REM --- ARGUMEN CHROME UNTUK KIOSK MODE ---
set FLAGS=--kiosk "%URL%" ^
 --autoplay-policy=no-user-gesture-required ^
 --disable-features=MediaSessionService ^
 --no-first-run ^
 --disable-infobars ^
 --disable-translate ^
 --noerrdialogs ^
 --disable-background-networking ^
 --disable-component-update ^
 --disable-default-apps ^
 --start-maximized

echo Menjalankan Chrome Kiosk...
start "" %CHROME% %FLAGS%

REM --- OPSIONAL: Cegah layar sleep / mati otomatis ---
powercfg -change -monitor-timeout-ac 0 >nul
powercfg -change -standby-timeout-ac 0 >nul
powercfg -change -hibernate-timeout-ac 0 >nul

REM --- OPSIONAL: Tunggu 5 detik agar audio siap ---
timeout /t 5 /nobreak >nul

echo [%date% %time%] Chrome started >> C:\Kiosk\kiosk.log

REM --- Tutup command prompt setelah selesai ---
exit
