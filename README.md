# Anjungan Mandiri — Panduan Instalasi (Windows & Linux)

**Lokasi proyek:** `{ROOT_DIR}/anjungan-mandiri`

Repositori ini berisi dua aplikasi yang akan dijalankan bersamaan menggunakan **PM2**:

- `jkn-fp-bot-main/index.js`
- `node-print-server/server.js`

Agar instalasi mudah dan konsisten di Windows maupun Linux, gunakan skrip otomatis berikut di folder ini:

- `windows.ps1` — instal & jalankan di **Windows**
- `linux.sh` — instal & jalankan di **Linux**
-  — jalankan di powershele dengan administrator agar ps1 dapat di jalankan
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\windows.ps1` cara menjalankannya

> **Catatan:** Kedua skrip mendeteksi folder dasar (base dir) dari lokasi file skrip, jadi Anda cukup meletakkannya di **`{ROOT_DIR}/anjungan-mandiri`**.

---

## 1) Prasyarat

- Akses internet.
- Hak Administrator (Windows) atau sudoer (Linux) untuk instalasi paket.
- **Node.js 22.20.x** (akan dipasang otomatis bila belum ada).
- **pm2** (akan dipasang otomatis bila belum ada).

> Versi Node yang digunakan: **22.20.x** untuk kompatibilitas dengan dependensi saat ini.

---

## 2) Instalasi Cepat

### Windows
1. Buka **PowerShell** sebagai **Administrator**.
2. Pindah ke folder proyek:
   ```powershell
   cd {ROOT_DIR}/anjungan-mandiri
   ```
3. Jalankan skrip (pilih salah satu):
   - Jalankan ini sebelum di jalankan di powershell
     ```powershell
      Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted -Force;
     ```
   - Jika tersedia **PowerShell 7**:  
     ```powershell
     pwsh -NoProfile -ExecutionPolicy Bypass -File .\windows.ps1
     ```
   - Jika hanya ada **Windows PowerShell 5.1**:  
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .\windows.ps1
     ```

### Linux (Ubuntu/Debian/CentOS/others)
1. Pindah ke folder proyek:
   ```bash
   cd {ROOT_DIR}/anjungan-mandiri
   ```
2. Beri izin eksekusi lalu jalankan:
   ```bash
   chmod +x linux.sh
   ./linux.sh
   ```

> Kedua skrip bersifat **idempotent**: aman dijalankan ulang untuk update dependensi atau menyalakan ulang layanan.

---

## 3) Apa yang Dikerjakan Skrip

1. **Cek/instal Node.js 22.20.x**
   - Windows: via `winget` atau MSI resmi Node.js.
   - Linux: via repositori NodeSource / paket manager, lalu dipastikan ke 22.20.x.
2. **Cek/instal PM2** secara global (`npm i -g pm2`).
3. Menjalankan **`npm install`/`npm ci`** pada:
   - `{ROOT_DIR}/anjungan-mandiri/jkn-fp-bot-main/`
   - `{ROOT_DIR}/anjungan-mandiri/node-print-server/`
4. Menjalankan aplikasi dengan **PM2** dan mengaktifkan **autostart** saat komputer menyala:
   - `pm2 startup` + `pm2 save`
   - Proses:
     - **`jkn-fp-bot-main`** → menjalankan `index.js`
     - **`node-print-server`** → menjalankan `server.js`

> Jika Anda menambahkan file **`ecosystem.config.js`** di folder ini, skrip bisa men-start keduanya sekaligus dari satu file konfigurasi PM2.

Contoh `ecosystem.config.js` (opsional):
```js
module.exports = {
  apps: [
    {
      name: 'jkn-fp-bot-main',
      cwd: './jkn-fp-bot-main',
      script: 'index.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      time: true
    },
    {
      name: 'node-print-server',
      cwd: './node-print-server',
      script: 'server.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      time: true
    }
  ]
}
```

---

## 4) Perintah PM2 yang Berguna

```bash
# Lihat status semua proses
pm2 status

# Lihat log (realtime)
pm2 logs jkn-fp-bot-main --lines 200
pm2 logs node-print-server --lines 200

# Restart salah satu layanan
pm2 restart jkn-fp-bot-main
pm2 restart node-print-server

# Hentikan / hapus dari PM2
pm2 stop jkn-fp-bot-main
pm2 delete jkn-fp-bot-main

# Simpan daftar proses untuk autostart
pm2 save
```

**Lokasi log PM2:**
- **Linux:** `~/.pm2/logs/`
- **Windows:** `%USERPROFILE%\.pm2\logs\`

---

## 5) Update Aplikasi

Ketika ada perubahan kode (mis. setelah `git pull`):

```bash
# di folder anjungan-mandiri
cd {ROOT_DIR}/anjungan-mandiri

# opsional: jalankan ulang skrip otomatis (disarankan)
# Windows:  pwsh -NoProfile -ExecutionPolicy Bypass -File .\windows.ps1
# Linux:    ./linux.sh

# atau update manual per modul
cd jkn-fp-bot-main && npm ci && cd ..
cd node-print-server && npm ci && cd ..
pm2 restart jkn-fp-bot-main
pm2 restart node-print-server
pm2 save
```

---

## 6) Mengganti Versi Node.js (opsional)

- **Windows:** ubah variabel `RequiredNodeVersion` di `windows.ps1`.
- **Linux:** ubah variabel `REQUIRED_NODE` di `linux.sh`.

Lalu jalankan ulang skrip sesuai OS Anda.

---

## 7) Uninstall / Bersih-bersih (opsional)

> Ini hanya menghentikan layanan dari PM2. Penghapusan Node.js/PM2 dari sistem silakan dilakukan manual via package manager/Apps.

```bash
pm2 delete jkn-fp-bot-main
pm2 delete node-print-server
pm2 save
# Nonaktifkan autostart PM2 (opsional)
pm2 unstartup
```

- **Windows:** hapus task/service PM2 yang dibuat oleh `pm2 startup` jika diperlukan.
- **Linux:** periksa service systemd PM2: `systemctl --user status pm2-$USER`.

---

## 8) Troubleshooting

### Windows
- **ExecutionPolicy blokir skrip**  
  Jalankan PowerShell sebagai Administrator lalu:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```
- **`connect EPERM //./pipe/rpc.sock` saat `pm2 list`**  
  Biasanya daemon PM2 bermasalah atau kurang hak akses. Coba:
  ```powershell
  pm2 kill
  pm2 startup windows -u $env:UserName --hp $HOME
  pm2 save
  pm2 resurrect
  ```
  Pastikan jalankan PowerShell sebagai Administrator.
- **`npm install` lambat**  
  Periksa koneksi internet & antivirus. Anda bisa menjeda real‑time scan untuk folder proyek (opsional) atau jalankan `npm ci` jika ada `package-lock.json`.

### Linux
- **`command not found: node/npm`**  
  Jalankan ulang `./linux.sh` (skrip akan memasang Node & npm).
- **Versi Node tidak 22.20.x**  
  Pakai tool `n` (skrip akan menginstal otomatis):  
  ```bash
  sudo npm -g install n
  sudo n 22.20.0
  ```
- **Port sudah terpakai**  
  Cek port layanan Anda lalu sesuaikan konfigurasi aplikasi. Contoh cek cepat: `ss -ltnp`.

---

## 9) Struktur Proyek (ringkas)

```
anjungan-mandiri/
├─ windows.ps1
├─ linux.sh
├─ ecosystem.config.js   # (opsional)
├─ jkn-fp-bot-main/
│  ├─ index.js
│  └─ package.json
└─ node-print-server/
   ├─ server.js
   └─ package.json
```

---

## 10) Catatan

- Jalankan skrip **dari folder ini** (`{ROOT_DIR}/anjungan-mandiri`).
- Pastikan user yang menjalankan `pm2 startup` sama dengan user yang menjalankan proses PM2 (agar autostart bekerja).
- Gunakan `npm ci` untuk instalasi yang cepat & deterministik bila ada `package-lock.json`.

---

Selesai. Jika ada kebutuhan khusus (ENV, port, printer, dsb.), sesuaikan langsung di masing‑masing aplikasi (`jkn-fp-bot-main` & `node-print-server`).

