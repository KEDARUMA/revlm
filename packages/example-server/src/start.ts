import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startHttpsProxy } from './https-proxy.js';

function resolvePackageRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

function resolveRevlmServerStartJs(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('@kedaruma/revlm-server/dist/start.js');
}

function resolvePidFile(): string {
  const configured = process.env.EXAMPLE_SERVER_PID_FILE;
  return configured ? path.resolve(process.cwd(), configured) : path.resolve(resolvePackageRoot(), '.example-server.pid');
}

async function run() {
  const envFile = process.env.EXAMPLE_SERVER_ENV
    ? path.resolve(process.cwd(), process.env.EXAMPLE_SERVER_ENV)
    : path.resolve(resolvePackageRoot(), '.env.start');
  loadEnv({ path: envFile, override: true });
  const proxyEnvFile = process.env.EXAMPLE_PROXY_ENV
    ? path.resolve(process.cwd(), process.env.EXAMPLE_PROXY_ENV)
    : path.resolve(resolvePackageRoot(), '.env.proxy');
  loadEnv({ path: proxyEnvFile, override: true });

  const pidFile = resolvePidFile();
  const startJsPath = resolveRevlmServerStartJs();
  let child: ChildProcess | undefined;
  let proxyServer: import('node:https').Server | undefined;
  let shuttingDown = false;

  try {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    child = spawn(process.execPath, [startJsPath], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: 'inherit',
    });

    if (!child.pid) {
      throw new Error('[example-server] failed to spawn revlm-server');
    }
    // eslint-disable-next-line no-console
    console.log('[example-server] revlm-server spawned', { pid: child.pid });

    proxyServer = startHttpsProxy({
      target: process.env.EXAMPLE_PROXY_TARGET || `http://127.0.0.1:${process.env.PORT || 4122}`,
    });
    // eslint-disable-next-line no-console
    console.log('[example-server] https proxy start requested');

    fs.writeFileSync(pidFile, String(process.pid), 'utf8');

    const shutdown = async (exitCode: number) => {
      if (shuttingDown) return;
      shuttingDown = true;
      // eslint-disable-next-line no-console
      console.log('[example-server] Stopping example server...');
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
      if (proxyServer) {
        await new Promise<void>((resolve) => proxyServer!.close(() => resolve()));
        // eslint-disable-next-line no-console
        console.log('[example-server] https proxy stopped');
      }
      if (child && child.pid) {
        try {
          child.kill('SIGTERM');
          // eslint-disable-next-line no-console
          console.log('[example-server] revlm-server stop requested');
        } catch {
          // ignore
        }
      }
      process.exit(exitCode);
    };

    child.on('exit', (code, signal) => {
      // eslint-disable-next-line no-console
      console.log('[example-server] revlm-server exited', { code, signal });
      void shutdown(code === 0 ? 0 : 1);
    });

    process.on('SIGINT', () => void shutdown(0));
    process.on('SIGTERM', () => void shutdown(0));
    process.on('uncaughtException', async (error) => {
      console.error('Unhandled error starting example server', error);
      await shutdown(1);
    });
  } catch (error) {
    console.error('Failed to start example server', error);
    process.exit(1);
  }
}

run();
