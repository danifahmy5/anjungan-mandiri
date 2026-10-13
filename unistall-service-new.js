const Service = require('node-windows').Service;
const path = require('path');

// JKN Fingerprint Bot sekarang berjalan sebagai Scheduled Task agar dapat
// mengakses desktop interaktif (dibutuhkan oleh AutoIt).
try {
  try {
    require('child_process').execFileSync(
      'schtasks.exe',
      ['/End', '/TN', 'JKN Fingerprint Bot'],
      { stdio: 'ignore' }
    );
  } catch (_) {
    // Task tidak sedang berjalan atau belum pernah dibuat.
  }

  require('child_process').execFileSync(
    'schtasks.exe',
    ['/Delete', '/F', '/TN', 'JKN Fingerprint Bot'],
    { stdio: 'inherit' }
  );
  console.log('Sukses: Scheduled Task JKN Fingerprint Bot telah dihapus.');
} catch (_) {
  console.log('Scheduled Task JKN Fingerprint Bot tidak ditemukan.');
}

// Tetap bersihkan instalasi model service dari versi lama.
const fpService = new Service({
  name: 'JKN Fingerprint Bot Service',
  script: path.join(__dirname, 'jkn-fp-bot-main', 'index.js')
});

fpService.on('uninstall', function() {
  console.log('Sukses: JKN Fingerprint Service versi lama telah dihapus.');
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
