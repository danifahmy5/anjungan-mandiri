const Service = require('node-windows').Service;
const path = require('path');

// Service Fingerprint
const fpService = new Service({
  name: 'JKN Fingerprint Bot Service',
  script: path.join(__dirname, 'jkn-fp-bot-main', 'index.js')
});

fpService.on('uninstall', function() {
  console.log('Sukses: JKN Fingerprint Service telah dihapus.');
});

// Service Printer
const printService = new Service({
  name: 'Node Print Server Service',
  script: path.join(__dirname, 'node-print-server', 'server.js')
});

printService.on('uninstall', function() {
  console.log('Sukses: Node Print Server Service telah dihapus.');
});

// Eksekusi Hapus
console.log('Sedang menghapus services dari Windows...');
fpService.uninstall();
printService.uninstall();
