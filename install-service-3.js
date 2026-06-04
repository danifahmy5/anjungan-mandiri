const { execSync } = require('child_process');
const path = require('path');

// =========================================================================
// 1. OTOMATIS INSTAL NODE-WINDOWS DI FOLDER UTAMA (ROOT)
// =========================================================================
try {
  console.log('=== [1/4] Memeriksa & Menginstal node-windows di Root ===');
  // Menjalankan npm install node-windows secara otomatis di folder utama
  execSync('npm install node-windows --save-dev', { cwd: __dirname, stdio: 'inherit' });
  console.log('✅ node-windows siap digunakan!\n');
} catch (error) {
  console.error('❌ Gagal menginstal node-windows di folder root:', error.message);
  process.exit(1);
}

// Sekarang baru aman untuk me-require node-windows
const Service = require('node-windows').Service;

// =========================================================================
// 2. OTOMATISASI DEPENDENCIES & PUPPETEER CHROME (NODE PRINT SERVER)
// =========================================================================
try {
  console.log('=== [2/4] Menyiapkan Node Print Server ===');
  const printServerPath = path.join(__dirname, 'node-print-server');
  
  console.log('👉 Menjalankan "npm install" di folder node-print-server...');
  execSync('npm install', { cwd: printServerPath, stdio: 'inherit' });

  console.log('👉 Mengunduh Chrome Puppeteer ke dalam folder lokal...');
  execSync('npx puppeteer browsers install chrome', { cwd: printServerPath, stdio: 'inherit' });
  
  console.log('✅ Setup folder node-print-server selesai!\n');
} catch (error) {
  console.error('❌ Gagal melakukan setup Puppeteer:', error.message);
  process.exit(1);
}

// =========================================================================
// 3. OTOMATISASI DEPENDENCIES (JKN FINGERPRINT BOT)
// =========================================================================
try {
  console.log('=== [3/4] Menyiapkan JKN Fingerprint Bot ===');
  const fpBotPath = path.join(__dirname, 'jkn-fp-bot-main');
  
  console.log('👉 Menjalankan "npm install" di folder jkn-fp-bot-main...');
  execSync('npm install', { cwd: fpBotPath, stdio: 'inherit' });
  
  console.log('✅ Setup folder jkn-fp-bot-main selesai!\n');
} catch (error) {
  console.warn('⚠️ Peringatan: npm install jkn-fp-bot gagal/dilewati, beralih ke registrasi service...');
}

// =========================================================================
// 4. REGISTER WINDOWS SERVICES (MENGGUNAKAN NODE-WINDOWS)
// =========================================================================
console.log('=== [4/4] Mendaftarkan Services ke Windows (services.msc) ===');

// CONFIG SERVICE FINGERPRINT (jkn-fp-bot)
const fpService = new Service({
  name: 'JKN Fingerprint Bot Service',
  description: 'Service latar belakang untuk mesin sidik jari JKN (BPJS).',
  script: path.join(__dirname, 'jkn-fp-bot-main', 'index.js'),
  cwd: path.join(__dirname, 'jkn-fp-bot-main'), 
  env: [{ name: 'NODE_ENV', value: 'production' }]
});

fpService.on('install', function() {
  console.log('👍 Sukses: JKN Fingerprint Bot Service terpasang dan berjalan!');
  fpService.start();
});

// CONFIG SERVICE PRINTER (node-print-server)
const printService = new Service({
  name: 'Node Print Server Service',
  description: 'Service latar belakang untuk printer cetak struk/label.',
  script: path.join(__dirname, 'node-print-server', 'server.js'),
  cwd: path.join(__dirname, 'node-print-server'), 
  env: [
    { name: 'NODE_ENV', value: 'production' },
    // Paksa Puppeteer membaca cache lokal folder print server, bukan System32
    { name: 'PUPPETEER_CACHE_DIR', value: path.join(__dirname, 'node-print-server', '.cache', 'puppeteer') }
  ]
});

printService.on('install', function() {
  console.log('👍 Sukses: Node Print Server Service terpasang dan berjalan!');
  printService.start();
});

// Eksekusi Pemasangan
console.log('Sedang mendaftarkan services dengan Native CWD...');
fpService.install();
printService.install();
