const Service = require('node-windows').Service;
const path = require('path');

// ==========================================
// 1. CONFIG SERVICE FINGERPRINT (jkn-fp-bot)
// ==========================================
const fpService = new Service({
  name: 'JKN Fingerprint Bot Service',
  description: 'Service latar belakang untuk mesin sidik jari JKN (BPJS).',
  script: path.join(__dirname, 'jkn-fp-bot-main', 'index.js'),
  // CARA YANG BENAR: Mengunci folder kerja langsung dengan properti cwd
  cwd: path.join(__dirname, 'jkn-fp-bot-main'), 
  env: [{ name: 'NODE_ENV', value: 'production' }]
});

fpService.on('install', function() {
  console.log('Sukses: JKN Fingerprint Bot Service terpasang!');
  fpService.start();
});

// ==========================================
// 2. CONFIG SERVICE PRINTER (node-print-server)
// ==========================================
const printService = new Service({
  name: 'Node Print Server Service',
  description: 'Service latar belakang untuk printer cetak struk/label.',
  script: path.join(__dirname, 'node-print-server', 'server.js'),
  // CARA YANG BENAR: Mengunci folder kerja langsung dengan properti cwd
  cwd: path.join(__dirname, 'node-print-server'), 
  env: [{ name: 'NODE_ENV', value: 'production' }]
});

printService.on('install', function() {
  console.log('Sukses: Node Print Server Service terpasang!');
  printService.start();
});

// ==========================================
// EKSEKUSI PEMASANGAN
// ==========================================
console.log('Sedang membersihkan dan mendaftarkan ulang services dengan Native CWD...');
fpService.install();
printService.install();
