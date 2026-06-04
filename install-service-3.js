const { execSync } = require('child_process');
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

// =========================================================================
// 2. OTOMATISASI & PEMBUATAN KONFIGURASI PUPPETEER (NODE PRINT SERVER)
// =========================================================================
const printServerPath = path.join(__dirname, 'node-print-server');

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

// CONFIG SERVICE FINGERPRINT
const fpService = new Service({
  name: 'JKN Fingerprint Bot Service',
  description: 'Service latar belakang untuk mesin sidik jari JKN (BPJS).',
  script: path.join(__dirname, 'jkn-fp-bot-main', 'index.js'),
  cwd: path.join(__dirname, 'jkn-fp-bot-main'), 
  env: [{ name: 'NODE_ENV', value: 'production' }]
});

fpService.on('install', function() {
  console.log('👍 Sukses: JKN Fingerprint Bot Service terpasang!');
  fpService.start();
});

// CONFIG SERVICE PRINTER
const printService = new Service({
  name: 'Node Print Server Service',
  description: 'Service latar belakang untuk printer cetak struk/label.',
  script: path.join(__dirname, 'node-print-server', 'server.js'),
  cwd: printServerPath, 
  env: [
    { name: 'NODE_ENV', value: 'production' },
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
fpService.install();
printService.install();
