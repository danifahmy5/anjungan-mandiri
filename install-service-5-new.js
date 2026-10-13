const { execFileSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// =========================================================================
// HELPER DOWNLOAD SUMATRAPDF YANG LEBIH TAHAN MASALAH TLS
// =========================================================================
function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Biarkan proses berikutnya menampilkan error yang lebih relevan.
  }
}

function isValidZip(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 100000) return false;

  const header = Buffer.alloc(2);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }

  return header.toString('ascii') === 'PK';
}

function downloadSumatra(sumatraZip) {
  const urls = [
    'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip',
    'https://github.com/sumatrapdfreader/sumatrapdf/releases/download/3.6.1/SumatraPDF-3.6.1-64.zip',
  ];
  const errors = [];

  for (const url of urls) {
    // curl.exe tersedia secara bawaan pada Windows 10/11 dan tidak bergantung
    // pada konfigurasi TLS milik Windows PowerShell/.NET Framework lama.
    try {
      removeIfExists(sumatraZip);
      console.log(`   Mencoba curl.exe: ${url}`);
      execFileSync('curl.exe', [
        '--fail',
        '--location',
        '--retry', '3',
        '--retry-delay', '2',
        '--connect-timeout', '30',
        '--output', sumatraZip,
        url,
      ], { stdio: 'inherit' });

      if (isValidZip(sumatraZip)) return;
      throw new Error('File hasil unduhan bukan ZIP yang valid.');
    } catch (error) {
      errors.push(`curl.exe (${url}): ${error.message}`);
    }

    // Fallback untuk komputer yang tidak mempunyai curl.exe. TLS 1.2 dipaksa
    // sebelum Invoke-WebRequest dijalankan.
    try {
      removeIfExists(sumatraZip);
      console.log(`   Mencoba PowerShell TLS 1.2: ${url}`);
      const psCommand = [
        "$ErrorActionPreference='Stop'",
        '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
        "$ProgressPreference='SilentlyContinue'",
        `Invoke-WebRequest -UseBasicParsing -UserAgent 'Mozilla/5.0' -Uri '${url}' -OutFile '${sumatraZip.replace(/'/g, "''")}'`,
      ].join('; ');

      execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', psCommand,
      ], { stdio: 'inherit' });

      if (isValidZip(sumatraZip)) return;
      throw new Error('File hasil unduhan bukan ZIP yang valid.');
    } catch (error) {
      errors.push(`PowerShell (${url}): ${error.message}`);
    }
  }

  removeIfExists(sumatraZip);
  throw new Error(
    'SumatraPDF gagal diunduh melalui seluruh metode.\n' + errors.join('\n')
  );
}

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

const Service = require('node-windows').Service;

// JKN FP Bot memakai AutoIt dan wajib berada di desktop session user. Windows
// Service berada di Session 0, sehingga aplikasi BPJS tidak dapat ditemukan
// atau dikendalikan. Jalankan bot sebagai task interaktif saat user logon.
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

  for (const action of ['stop', 'delete']) {
    try {
      execFileSync('sc.exe', [action, 'JKN Fingerprint Bot Service'], { stdio: 'ignore' });
    } catch (_) {
      // Service lama tidak ada atau sudah dihapus.
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

  console.log('👉 Menjalankan "npm install" di folder node-print-server...');
  execSync('npm install', { cwd: printServerPath, stdio: 'inherit' });

  console.log('👉 Membuat file konfigurasi .puppeteerrc.cjs...');
  const puppeteerConfigContent = `const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};`;

  fs.writeFileSync(path.join(printServerPath, '.puppeteerrc.cjs'), puppeteerConfigContent, 'utf8');

  console.log('👉 Mengunduh ulang Chrome Puppeteer ke folder lokal...');
  execSync('npx puppeteer browsers install chrome', { cwd: printServerPath, stdio: 'inherit' });

  if (!fs.existsSync(sumatraPath)) {
    console.log('👉 Mengunduh SumatraPDF 3.6.1 untuk printer label...');
    fs.mkdirSync(sumatraDir, { recursive: true });
    const sumatraZip = path.join(sumatraDir, 'SumatraPDF-3.6.1-64.zip');

    downloadSumatra(sumatraZip);

    console.log('👉 Mengekstrak SumatraPDF...');
    const escapedZip = sumatraZip.replace(/'/g, "''");
    const escapedDir = sumatraDir.replace(/'/g, "''");
    const extractCommand = [
      "$ErrorActionPreference='Stop'",
      `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDir}' -Force`,
    ].join('; ');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', extractCommand,
    ], { cwd: printServerPath, stdio: 'inherit' });
    removeIfExists(sumatraZip);
  }

  if (!fs.existsSync(sumatraPath)) {
    throw new Error(`SumatraPDF 3.6.1 tidak ditemukan setelah instalasi: ${sumatraPath}`);
  }

  console.log('✅ Setup folder node-print-server beserta Chrome dan SumatraPDF selesai!\n');
} catch (error) {
  console.error('❌ Gagal melakukan setup Node Print Server:', error.message);
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

// =========================================================================
// 5. REGISTER WINDOWS SERVICES (MENGGUNAKAN NODE-WINDOWS)
// =========================================================================
console.log('=== [5/5] Mendaftarkan Services ke Windows (services.msc) ===');

const printService = new Service({
  name: 'Node Print Server Service',
  description: 'Service latar belakang untuk printer cetak struk/label.',
  script: path.join(__dirname, 'node-print-server', 'server-5.js'),
  cwd: __dirname,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'LABEL_WIDTH', value: '60mm' },
    { name: 'LABEL_HEIGHT', value: '20mm' },
    { name: 'LABEL_COPIES', value: '3' },
    { name: 'SUMATRA_PDF_PATH', value: sumatraPath },
    { name: 'PUPPETEER_CACHE_DIR', value: path.join(printServerPath, '.cache', 'puppeteer') }
  ]
});

printService.on('install', function() {
  console.log('👍 Sukses: Node Print Server Service terpasang!');
  printService.start();
});

console.log('Sedang mendaftarkan services baru dengan Native CWD...');
try {
  installInteractiveFpBot();
} catch (error) {
  console.error('❌ Gagal memasang JKN Fingerprint Bot sebagai Scheduled Task:', error.message);
  process.exitCode = 1;
}
printService.install();
