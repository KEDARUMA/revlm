const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const certPath = path.join(repoRoot, 'example-server', '.certs', 'localhost.pem');
const mkcertRoot = path.join(
  process.env.HOME || '',
  'Library',
  'Application Support',
  'mkcert',
  'rootCA.pem'
);

let trustCertPath = certPath;
if (fs.existsSync(mkcertRoot)) {
  trustCertPath = mkcertRoot;
}

if (!fs.existsSync(trustCertPath)) {
  console.error('[trust-ios] missing cert:', trustCertPath);
  console.error('[trust-ios] run: pnpm --filter @kedaruma/example-server setup-https');
  process.exit(1);
}

let booted = [];
try {
  const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
    encoding: 'utf8',
  });
  const json = JSON.parse(raw);
  const devicesByRuntime = Object.values(json.devices || {});
  booted = devicesByRuntime.flat().filter((d) => d.state === 'Booted').map((d) => d.udid);
} catch (err) {
  console.error('[trust-ios] failed to read booted simulators:', err?.message || String(err));
  process.exit(1);
}

if (booted.length === 0) {
  console.error('[trust-ios] no booted simulator found');
  process.exit(1);
}

let success = 0;
for (const udid of booted) {
  try {
    // Trust localhost cert in the booted simulator.
    // 起動中のシミュレータに localhost 証明書を信頼させる。
    execFileSync('xcrun', ['simctl', 'keychain', udid, 'add-root-cert', trustCertPath], {
      stdio: 'inherit',
    });
    success += 1;
  } catch (err) {
    console.warn(`[trust-ios] warn: ${udid} (${err?.message || String(err)})`);
  }
}

if (success === 0) {
  console.error('[trust-ios] failed to add cert to any booted simulator');
  process.exit(1);
}

console.log(`[trust-ios] done: ${success} simulator(s) updated`);
