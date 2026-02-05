import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function resolvePackageRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: env ?? process.env });
  if (res.status !== 0) {
    throw new Error(`[setup-https] failed: ${cmd} ${args.join(' ')}`);
  }
}

function resolveJavaHome(): string | undefined {
  const res = spawnSync('/usr/libexec/java_home', [], { stdio: 'pipe' });
  if (res.status !== 0) return undefined;
  const raw = (res.stdout || '').toString().trim();
  return raw.length > 0 ? raw : undefined;
}

function main() {
  const root = resolvePackageRoot();
  const certDir = path.join(root, '.certs');
  const keyFile = path.join(certDir, 'localhost-key.pem');
  const certFile = path.join(certDir, 'localhost.pem');

  fs.mkdirSync(certDir, { recursive: true });

  const mkcertCheck = spawnSync('mkcert', ['-version'], { stdio: 'ignore' });
  if (mkcertCheck.error) {
    console.error('[setup-https] mkcert is not installed. Install mkcert and retry.');
    process.exit(1);
  }

  const javaHome = resolveJavaHome();
  const mkcertEnv = javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env;
  run('mkcert', ['-install'], mkcertEnv);

  run('mkcert', [
    '-key-file',
    keyFile,
    '-cert-file',
    certFile,
    'localhost',
    '127.0.0.1',
    '::1',
  ]);

  console.log('[setup-https] certs created:', { keyFile, certFile });
}

try {
  main();
} catch (error) {
  console.error('[setup-https] failed to create certs. See output above.');
  process.exit(1);
}
