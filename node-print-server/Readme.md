Untuk menjalankan skrip ini secara otomatis saat restart, Anda bisa menggunakan Task Scheduler:

   1. Buka Task Scheduler (Anda bisa mencarinya di Start Menu).
   2. Di panel Actions, klik Create Basic Task....
   3. Beri nama tugas (misalnya, "Start Node Server") dan klik Next.
   4. Pilih When the computer starts sebagai pemicu (trigger) dan klik Next.
   5. Pilih Start a program dan klik Next.
   6. Di bagian "Program/script", ketik powershell.exe.
   7. Di bagian "Add arguments (optional)", salin dan tempel baris berikut:
   1     -ExecutionPolicy Bypass -File "D:\RSA\node-print-server\start-server.ps1"
   8. Klik Next, lalu Finish.