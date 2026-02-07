const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const certPath = path.join(repoRoot, 'example-server', '.certs', 'localhost.pem');
const remotePath = '/sdcard/Download/localhost.pem';

if (!fs.existsSync(certPath)) {
  console.error('[trust-android] missing cert:', certPath);
  console.error('[trust-android] run: pnpm --filter @kedaruma/example-server setup-https');
  process.exit(1);
}

try {
  execFileSync('adb', ['start-server'], { stdio: 'ignore' });
} catch (err) {
  console.error('[trust-android] adb not found. Install Android platform tools.');
  process.exit(1);
}

let devices = [];
try {
  const raw = execFileSync('adb', ['devices'], { encoding: 'utf8' });
  devices = raw
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);
} catch (err) {
  console.error('[trust-android] failed to list devices:', err?.message || String(err));
  process.exit(1);
}

if (devices.length === 0) {
  console.error('[trust-android] no emulator/device found');
  process.exit(1);
}

for (const serial of devices) {
  // Push cert and open the installer UI (user confirmation is required).
  // 証明書を送信し、インストーラUIを開く（ユーザ操作が必要）。
  execFileSync('adb', ['-s', serial, 'push', certPath, remotePath], { stdio: 'inherit' });
  execFileSync(
    'adb',
    [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-t',
      'application/x-x509-ca-cert',
      '-d',
      `file://${remotePath}`,
    ],
    { stdio: 'inherit' }
  );
}

console.log('[trust-android] certificate installer opened on emulator(s)');
