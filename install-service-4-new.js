const { execFileSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// =========================================================================
// 1. OTOMATIS INSTAL NODE-WINDOWS DI FOLDER UTAMA (ROOT)
// =========================================================================
try {
  console.log('=== [1/5] Memeriksa & Menginstal node-windows di Root ===');
  execSync('npm install node-windows --save-dev', { cwd: __dirname, stdio: 'inherit' });
  console.log('✅ node-windows siap digunakan!\n');
} catch (error) {
  console.error('❌ Gagal menginstal node-windows di folder root:', error.message);
  process.exit(1);
}

// Me-require node-windows setelah dipastikan terinstal
const Service = require('node-windows').Service;

// JKN FP Bot mengendalikan aplikasi desktop melalui AutoIt. Karena Windows
// Service berjalan di Session 0, bot harus dijalankan pada sesi user yang
// sedang login. Scheduled Task ONLOGON memberi perilaku startup otomatis yang
// sama, tetapi tetap memiliki akses ke desktop interaktif.
function installInteractiveFpBot() {
  const taskName = 'JKN Fingerprint Bot';
  const fpBotPath = path.join(__dirname, 'jkn-fp-bot-main');
  const launcherPath = path.join(fpBotPath, 'run-jkn-fp-bot.cmd');
  const logPath = path.join(fpBotPath, 'jkn-fp-bot.log');
  const quoteForCmd = (value) => `"${value.replace(/"/g, '""')}"`;
  const launcher = [
    '@echo off',
    `cd /d ${quoteForCmd(fpBotPath)}`,
    'set NODE_ENV=production',
    ':restart',
    `${quoteForCmd(process.execPath)} ${quoteForCmd(path.join(fpBotPath, 'index.js'))} >> ${quoteForCmd(logPath)} 2>&1`,
    'timeout /t 5 /nobreak > nul',
    'goto restart',
    '',
  ].join('\r\n');

  fs.writeFileSync(launcherPath, launcher, 'utf8');

  let taskUser = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;

  if (!taskUser) {
    taskUser = execSync('whoami', { encoding: 'utf8' }).trim();
  }

  // Hapus service versi lama agar tidak berebut port 3000 dari Session 0.
  for (const action of ['stop', 'delete']) {
    try {
      execFileSync('sc.exe', [action, 'JKN Fingerprint Bot Service'], { stdio: 'ignore' });
    } catch (_) {
      // Service belum ada atau sudah terhapus.
    }
  }

  execFileSync('schtasks.exe', [
    '/Create', '/F',
    '/TN', taskName,
    '/TR', `"${launcherPath}"`,
    '/SC', 'ONLOGON',
    '/RU', taskUser,
    '/RL', 'HIGHEST',
    '/IT',
  ], { stdio: 'inherit' });

  execFileSync('schtasks.exe', ['/Run', '/TN', taskName], { stdio: 'inherit' });
  console.log(`👍 Sukses: ${taskName} berjalan pada sesi desktop ${taskUser}.`);
}

// =========================================================================
// 2. OTOMATISASI & PEMBUATAN KONFIGURASI PUPPETEER (NODE PRINT SERVER)
// =========================================================================
const printServerPath = path.join(__dirname, 'node-print-server');
const sumatraDir = path.join(printServerPath, 'bin', 'sumatra');
const sumatraPath = path.join(sumatraDir, 'SumatraPDF-3.6.1-64.exe');

try {
  console.log('=== [2/5] Menyiapkan Node Print Server ===');
  
  // Menjalankan npm install di folder node-print-server
  console.log('👉 Menjalankan "npm install" di folder node-print-server...');
  execSync('npm install', { cwd: printServerPath, stdio: 'inherit' });

  // TRIK AMPUH: Membuat file .puppeteerrc.cjs langsung di folder node-print-server
  // Ini memastikan bahwa perintah instalasi ataupun runtime SELALU meletakkan Chrome di folder project tersebut
  console.log('👉 Membuat file konfigurasi .puppeteerrc.cjs...');
  const puppeteerConfigContent = `const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};`;
  
  fs.writeFileSync(path.join(printServerPath, '.puppeteerrc.cjs'), puppeteerConfigContent, 'utf8');

  // Menjalankan download Chrome secara eksplisit
  console.log('👉 Mengunduh ulang Chrome Puppeteer ke folder lokal...');
  execSync('npx puppeteer browsers install chrome', { cwd: printServerPath, stdio: 'inherit' });

  // Versi 3.4.6 bawaan pdf-to-printer belum mendukung disable-auto-rotation.
  if (!fs.existsSync(sumatraPath)) {
    console.log('👉 Mengunduh SumatraPDF 3.6.1 untuk printer label...');
    fs.mkdirSync(sumatraDir, { recursive: true });
    const sumatraZip = path.join(sumatraDir, 'SumatraPDF-3.6.1-64.zip');
    const downloadUrl = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip';
    const psCommand = [
      "$ErrorActionPreference='Stop'",
      `Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${sumatraZip}'`,
      `Expand-Archive -LiteralPath '${sumatraZip}' -DestinationPath '${sumatraDir}' -Force`,
      `Remove-Item -LiteralPath '${sumatraZip}' -Force`,
    ].join('; ');
    execSync(`powershell.exe -NoProfile -Command "${psCommand}"`, {
      cwd: printServerPath,
      stdio: 'inherit',
    });
  }

  if (!fs.existsSync(sumatraPath)) {
    throw new Error(`SumatraPDF 3.6.1 tidak ditemukan setelah instalasi: ${sumatraPath}`);
  }
  
  console.log('✅ Setup folder node-print-server beserta Chrome selesai!\n');
} catch (error) {
  console.error('❌ Gagal melakukan setup Puppeteer:', error.message);
  process.exit(1);
}

// =========================================================================
// 3. OTOMATISASI DEPENDENCIES (JKN FINGERPRINT BOT)
// =========================================================================
try {
  console.log('=== [3/5] Menyiapkan JKN Fingerprint Bot ===');
  const fpBotPath = path.join(__dirname, 'jkn-fp-bot-main');
  
  console.log('👉 Menjalankan "npm install" di folder jkn-fp-bot-main...');
  execSync('npm install', { cwd: fpBotPath, stdio: 'inherit' });
  
  console.log('✅ Setup folder jkn-fp-bot-main selesai!\n');
} catch (error) {
  console.warn('⚠️ Peringatan: npm install jkn-fp-bot gagal/dilewati, beralih ke registrasi service...');
}

// =========================================================================
// 4. BERSIHKAN SERVICE LAMA JIKA MASIH MENYANGKUT
// =========================================================================
console.log('=== [4/5] Membersihkan Service Lama jika Ada ===');
// Ini untuk mencegah service crash karena bentrok dengan instalasi sebelumnya

// =========================================================================
// 5. REGISTER WINDOWS SERVICES (MENGGUNAKAN NODE-WINDOWS)
// =========================================================================
console.log('=== [5/5] Mendaftarkan Services ke Windows (services.msc) ===');

// CONFIG SERVICE PRINTER
const printService = new Service({
  name: 'Node Print Server Service',
  description: 'Service latar belakang untuk printer cetak struk/label.',
  script: path.join(__dirname, 'node-print-server', 'server.js'),
  // Samakan working directory dengan ecosystem.config.yaml (PM2).
  cwd: __dirname,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'LABEL_WIDTH', value: '60mm' },
    { name: 'LABEL_HEIGHT', value: '20mm' },
    { name: 'LABEL_COPIES', value: '3' },
    { name: 'SUMATRA_PDF_PATH', value: sumatraPath },
    // Jaga-jaga jika config rc terlewati, env variable tetap mengunci jalurnya
    { name: 'PUPPETEER_CACHE_DIR', value: path.join(printServerPath, '.cache', 'puppeteer') }
  ]
});

printService.on('install', function() {
  console.log('👍 Sukses: Node Print Server Service terpasang!');
  printService.start();
});

// Eksekusi Pemasangan
console.log('Sedang mendaftarkan services baru dengan Native CWD...');
try {
  installInteractiveFpBot();
} catch (error) {
  console.error('❌ Gagal memasang JKN Fingerprint Bot sebagai Scheduled Task:', error.message);
  process.exitCode = 1;
}
printService.install();
