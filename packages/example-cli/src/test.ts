import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes as nodeRandomBytes } from 'crypto';
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import { runExampleFlow } from './run.js';

// Track child process + assigned port.
// 子プロセスと割当ポートの保持。
type ServerProcess = {
  child: ReturnType<typeof spawn>;
  port: number;
};

type ExampleClientOptions = {
  baseUrl: string;
  sessionId: string;
  provisionalAuthId: string;
  provisionalAuthSecretMaster: string;
  provisionalAuthDomain: string;
  autoRefreshOn401: boolean;
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

// In-memory refresh secret store for CLI (header-based refresh).
// CLI向けのリフレッシュシークレット保持（ヘッダ方式）。
function createRefreshSecretStore() {
  let refreshSecret: string | undefined;
  return {
    get: () => refreshSecret,
    setFromSetCookie: (setCookieHeader?: string | null) => {
      if (!setCookieHeader) return;
      const [cookiePair] = setCookieHeader.split(';');
      if (!cookiePair) return;
      const sep = cookiePair.indexOf('=');
      if (sep === -1) return;
      const name = cookiePair.slice(0, sep).trim();
      if (name !== 'revlm_refresh') return;
      refreshSecret = cookiePair.slice(sep + 1).trim();
    },
  };
}

// Fetch wrapper to capture refresh secret and send it via header.
// refresh シークレットを保持してヘッダ送信する fetch ラッパー。
function createFetchImpl(refreshStore: { get: () => string | undefined; setFromSetCookie: (value?: string | null) => void }): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const headers = new Headers(init?.headers || {});
    if (url.includes('/refresh-token')) {
      const refreshSecret = refreshStore.get();
      if (refreshSecret) {
        headers.set('x-revlm-refresh', refreshSecret);
      }
      headers.delete('cookie');
    }
    const res = await fetch(input, { ...init, headers });
    try {
      const setCookieHeader = (res.headers as any)?.getSetCookie?.() ?? res.headers.get('set-cookie');
      const raw = Array.isArray(setCookieHeader) ? setCookieHeader.join(',') : setCookieHeader;
      refreshStore.setFromSetCookie(raw);
    } catch {
      // noop
      // 何もしない。
    }
    return res;
  };
}

// Create a client configured for the CLI refresh flow.
// CLIのリフレッシュフロー用クライアントを作成する。
function createExampleClient(options: ExampleClientOptions) {
  const refreshStore = createRefreshSecretStore();
  const fetchImpl = createFetchImpl(refreshStore);
  // Use Node crypto for AuthClient.
  // AuthClient 用に Node crypto を使う。
  const randomBytes = (length: number) => new Uint8Array(nodeRandomBytes(length));
  return new Revlm(options.baseUrl, {
    provisionalEnabled: true,
    provisionalAuthSecretMaster: options.provisionalAuthSecretMaster,
    provisionalAuthDomain: options.provisionalAuthDomain,
    autoSetToken: true,
    autoRefreshOn401: options.autoRefreshOn401,
    sessionId: options.sessionId,
    fetchImpl,
    randomBytes,
    logLevel: 'info',
  });
}

// Register + login to get a valid session.
// 登録とログインで有効なセッションを作る。
async function createSession(revlm: Revlm, authId: string, password: string, provisionalAuthId: string) {
  const provisional = await revlm.provisionalLogin(provisionalAuthId);
  if (!provisional.ok) {
    throw new Error(`provisional login failed: ${provisional.error || provisional.reason}`);
  }
  const registerRes = await revlm.registerUser({ authId, userType: 'staff', roles: ['example'], name: 'Example CLI' }, password);
  if (!registerRes.ok) {
    throw new Error(`registerUser failed: ${registerRes.error || registerRes.reason}`);
  }
  const loginRes = await revlm.login(authId, password);
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.error || loginRes.reason}`);
  }
}

// Wait helper for token expiry.
// トークン期限切れ待機。
async function waitForTokenExpiry() {
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

// Verify that expired token returns 401 and refresh succeeds.
// 期限切れトークンが401になり、refreshが成功することを確認する。
async function verifyExpiredTokenFlow(options: ExampleClientOptions) {
  const authId = `example-cli-expired-${Date.now()}`;
  const password = 'example-pass';
  const revlm = createExampleClient({ ...options, autoRefreshOn401: false });
  await createSession(revlm, authId, password, options.provisionalAuthId);
  await waitForTokenExpiry();

  const coll = revlm.db('revlm').collection<{ _id: unknown; name: string; value: number }>('example_items');
  let expiredOk = false;
  try {
    await coll.find({});
  } catch (err: any) {
    if (err?.response?.status === 401) {
      expiredOk = true;
    } else {
      throw err;
    }
  }
  if (!expiredOk) {
    throw new Error('expected 401 on expired token');
  }

  const refreshRes = await revlm.refreshToken();
  if (!refreshRes.ok) {
    throw new Error(`refresh failed: ${refreshRes.error || refreshRes.reason}`);
  }

  // If this call succeeds, the refreshed token is usable.
  // ここが成功すればリフレッシュ後のトークンが使えている。
  await coll.find({});
}

// Verify auto-refresh retries after 401 without manual refresh.
// 401後の自動リフレッシュが動作することを確認する。
async function verifyAutoRefreshFlow(options: ExampleClientOptions) {
  const authId = `example-cli-auto-${Date.now()}`;
  const password = 'example-pass';
  const revlm = createExampleClient({ ...options, autoRefreshOn401: true });
  await createSession(revlm, authId, password, options.provisionalAuthId);
  await waitForTokenExpiry();

  const coll = revlm.db('revlm').collection<{ _id: unknown; name: string; value: number }>('example_items');
  await coll.find({});
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

    const clientOptions: ExampleClientOptions = {
      baseUrl: `http://localhost:${server.port}`,
      sessionId: 'example-cli-session',
      provisionalAuthId: 'example-prov',
      provisionalAuthSecretMaster: 'example-master',
      provisionalAuthDomain: 'example.domain',
      autoRefreshOn401: false,
    };

    await verifyExpiredTokenFlow(clientOptions);
    await verifyAutoRefreshFlow({ ...clientOptions, autoRefreshOn401: true });
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
