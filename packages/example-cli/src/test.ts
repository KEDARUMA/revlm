import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { runExampleFlow } from './run';

// Track child process + assigned port.
// 子プロセスと割当ポートの保持。
type ServerProcess = {
  child: ReturnType<typeof spawn>;
  port: number;
};

// Pick a random high port to avoid conflicts.
// 競合を避けるため高めのポートをランダムに選ぶ。
function resolvePort(): number {
  const base = 48000;
  const span = 1000;
  return base + Math.floor(Math.random() * span);
}

// Start example-server as a child process and wait for readiness.
// child processとしてexample-serverを起動し、起動完了を待つ。
async function startExampleServer(port: number): Promise<ServerProcess> {
  const args = [
    '--filter',
    '@kedaruma/example-server',
    'start-with-opts',
    '--',
    '--port',
    String(port),
    '--jwtExpiresIn',
    '2',
    '--provisionalLoginEnabled',
    'true',
    '--provisionalAuthId',
    'example-prov',
    '--provisionalAuthSecretMaster',
    'example-master',
    '--provisionalAuthDomain',
    'example.domain',
    '--usersDbName',
    'revlm',
    '--usersCollectionName',
    'users',
    '--jwtSecret',
    'example-secret',
    '--refreshSecretSigningKey',
    'example-refresh-secret',
  ];
  // Spawn example-server with CLI overrides.
  // CLI引数で上書きしながらexample-serverを起動する。
  const child = spawn('pnpm', args, {
    cwd: process.cwd(),
    env: { ...process.env, EXAMPLE_SERVER_ENV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait until the server logs readiness.
  // 起動ログが出るまで待機する。
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('example-server start timeout'));
    }, 60000);
    const handleLine = (line: string) => {
      // Mirror server logs (minimal signal) so the user can confirm the server actually started.
      // 起動確認に必要なログのみを親側に転送する（ノイズを減らす）。
      const important =
        line.includes('Revlm server version') ||
        line.includes('MongoDB connected') ||
        line.includes('Revlm API server started on port') ||
        line.includes('Stopping example server') ||
        line.includes('error') ||
        line.includes('Error');
      if (important) {
        // eslint-disable-next-line no-console
        console.log(`[example-server] ${line}`);
      }
      if (line.includes('Revlm API server started on port')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    const stdout = child.stdout ? createInterface({ input: child.stdout }) : null;
    const stderr = child.stderr ? createInterface({ input: child.stderr }) : null;
    stdout?.on('line', handleLine);
    stderr?.on('line', handleLine);
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      if (code && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`example-server exited with code ${code}`));
      }
    });
  });

  await ready;
  return { child, port };
}

// Stop the example-server process.
// example-serverプロセスを停止する。
async function stopExampleServer(processInfo: ServerProcess) {
  // We stop by signal because this test spawns the server process directly.
  // In other contexts you can use `pnpm --filter @kedaruma/example-server stop` (PID-based).
  //
  // このテストではサーバを直接spawnしているので、シグナルで停止する。
  // 別の状況では `pnpm --filter @kedaruma/example-server stop`（PIDベース）も利用できる。
  processInfo.child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    processInfo.child.once('exit', () => resolve());
  });
}

// Run the CLI example flow against the temporary server.
// 一時サーバに対してCLIサンプルフローを実行する。
async function run() {
  const port = resolvePort();
  const server = await startExampleServer(port);
  try {
    // Execute the CLI demo flow against the temporary server.
    // 一時サーバに対してCLIデモフローを実行する。
    await runExampleFlow({
      baseUrl: `http://localhost:${server.port}`,
      usersDbName: 'revlm',
      provisionalAuthId: 'example-prov',
      provisionalAuthSecretMaster: 'example-master',
      provisionalAuthDomain: 'example.domain',
      sessionId: 'example-cli-session',
    });
  } finally {
    // Always stop the spawned server.
    // 起動したサーバは必ず停止する。
    //
    // This prevents the test suite from leaving zombie processes behind.
    // テスト実行後にプロセスが残る事故（ゾンビ化）を防ぐ。
    await stopExampleServer(server);
  }
}

// Entrypoint for pnpm test.
// pnpm test 用エントリポイント。
run().catch((error) => {
  console.error('Example CLI test failed', error);
  process.exit(1);
});
