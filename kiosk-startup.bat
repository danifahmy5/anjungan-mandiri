@echo off
:: Pindah ke direktori tujuan
cd /d "C:\Kiosk"

:: Menjalankan konfigurasi PM2
call pm2 start ecosystem.config.yaml

:: Menyimpan konfigurasi agar tetap berjalan setelah reboot
call pm2 save

:: Terminal akan tertutup otomatis setelah ini
exit
