const { execFileSync } = require('node:child_process');
const path = require('node:path');

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    stdio: 'inherit',
    ...options,
  });
}

function runCapture(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
  });
}

function assertAndroidDeviceOnline() {
  const raw = runCapture('adb', ['devices']);
  const devices = raw
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);

  if (!devices.length) {
    throw new Error('[prepare-android-https] no online Android emulator/device found');
  }
}

function main() {
  try {
    run('adb', ['start-server']);
    assertAndroidDeviceOnline();

    // Keep reverse settings deterministic for all developers.
    // 毎回同じ reverse 設定になるように初期化する。
    run('adb', ['reverse', '--remove-all']);
    run('adb', ['reverse', 'tcp:8081', 'tcp:8081']);
    run('adb', ['reverse', 'tcp:4123', 'tcp:4123']);

    const trustScript = path.join(__dirname, 'trust-android-emulator-cert.js');
    run('node', [trustScript]);

    console.log('[prepare-android-https] ready');
    console.log('[prepare-android-https] if cert installer opens, complete the install once');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

main();
