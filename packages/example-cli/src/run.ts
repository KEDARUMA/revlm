import { randomBytes as nodeRandomBytes } from 'crypto';
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import type * as RevlmCompat from '@kedaruma/revlm-client/revlm-compat';

// Demo defaults for the CLI walkthrough.
// CLIデモ用の既定値。
const DEFAULT_PASSWORD = 'example-pass';
const DEFAULT_COLLECTION = 'example_items';

type FlowOptions = {
  baseUrl: string;
  sessionId: string;
  provisionalAuthId: string;
  provisionalAuthSecretMaster: string;
  provisionalAuthDomain: string;
  usersDbName: string;

  // If true, the client automatically refreshes on 401 and retries the original request.
  // true の場合、401時に自動で refresh して元リクエストをリトライする。
  //
  // This is useful for long-running demo flows (e.g. printing reports).
  // デモでレポート出力など長時間処理を行う場合に便利。
  autoRefreshOn401?: boolean;

  // Optional fixed account for demo-only CLI runs.
  // デモ専用の固定アカウント（任意）。
  //
  // If provided, the flow skips "register user" and only performs:
  // login -> wait -> refreshToken -> data ops.
  //
  // 指定されている場合、ユーザ登録は行わず、
  // login -> wait -> refreshToken -> DB操作 のみ実行する。
  demoUser?: { authId: string; password: string };
  // If true, skip the refresh-token step (demo mode).
  // true の場合、refresh-token の検証をスキップする（デモ用）。
  skipRefresh?: boolean;

  // Optional hook for CLI-only workflows (used by `src/demo.ts`).
  // CLI用の任意フック（`src/demo.ts` から使用）。
  //
  // This allows the demo CLI to run additional queries after a successful refresh,
  // without impacting the automated test harness (`src/test.ts`).
  //
  // refresh 成功後に追加クエリを実行するためのフック。
  // 自動テスト（`src/test.ts`）には影響しないよう任意にしている。
  afterRefresh?: (ctx: { revlm: Revlm; usersDbName: string }) => Promise<void>;
};

// Simple wait helper for token expiration timing.
// トークン期限切れを待つための簡易スリープ。
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function runExampleFlow(options: FlowOptions) {
  // Human-friendly progress markers for demo output.
  // デモ出力として分かりやすい進捗ログ。
  const log = (...args: any[]) => console.log('[example-cli]', ...args);

  // Prepare client + refresh header support.
  // refresh ヘッダ送信のための準備。
  //
  // Note:
  // - `sessionId` is REQUIRED by the server for login/refresh in the current design.
  // - CLI uses a fixed sessionId by default (easy reproducibility in demos).
  //
  // 注意:
  // - 現設計では server 側が login/refresh で `sessionId` を必須としている。
  // - CLI ではデモの再現性を優先して固定 sessionId を使う。
  const refreshStore = createRefreshSecretStore();
  const fetchImpl = createFetchImpl(refreshStore);
  // Use Node crypto for AuthClient.
  // AuthClient 用に Node crypto を使う。
  const randomBytes = (length: number) => new Uint8Array(nodeRandomBytes(length));
  const revlm = new Revlm(options.baseUrl, {
    provisionalEnabled: true,
    provisionalAuthSecretMaster: options.provisionalAuthSecretMaster,
    provisionalAuthDomain: options.provisionalAuthDomain,
    autoSetToken: true,
    autoRefreshOn401: !!options.autoRefreshOn401,
    sessionId: options.sessionId,
    fetchImpl,
    randomBytes,
    logLevel: 'info',
  });

  // Resolve which account to use.
  // 使用するアカウントを決める。
  //
  // - Test harness (`pnpm test`) uses a new account each run (registers it).
  // - Manual demo (`pnpm start`) can use a fixed account (demo/demo-pass) created by example-server.
  //
  // - テスト（`pnpm test`）は毎回新規アカウントを作って使用する。
  // - 手動デモ（`pnpm start`）は example-server が用意する固定アカウントを使える。
  const useDemo = !!options.demoUser;
  const authId = useDemo ? options.demoUser!.authId : `example-cli-${Date.now()}`;
  const password = useDemo ? options.demoUser!.password : DEFAULT_PASSWORD;

  if (!useDemo) {
    // Create a fresh user for demonstration.
    // デモ用の新規ユーザを作成。
    const user = {
      authId,
      userType: 'staff',
      roles: ['example'],
      name: 'Example CLI',
    };
    log('user prepared', { authId, sessionId: options.sessionId });

    // 1) provisional login (to call registerUser).
    // 1) 仮ログイン（registerUserのため）。
    //
    // This step obtains a temporary token that is allowed to call /registerUser.
    // このステップで /registerUser 実行可能な一時トークンを取得する。
    log('provisionalLogin start');
    const provisionalRes = await revlm.provisionalLogin(options.provisionalAuthId);
    if (!provisionalRes.ok) throw new Error(`provisional login failed: ${provisionalRes.error || provisionalRes.reason}`);
    log('provisionalLogin ok');

    // 2) register user (creates a real account).
    // 2) ユーザ登録（本アカウント作成）。
    //
    // We create a new user per run so the demo is independent and repeatable.
    // 毎回新規ユーザを作ることで、デモを独立・再実行可能にする。
    log('registerUser start');
    const registerRes = await revlm.registerUser(user, DEFAULT_PASSWORD);
    if (!registerRes.ok) throw new Error(`registerUser failed: ${registerRes.error || registerRes.reason}`);
    log('registerUser ok');
  } else {
    log('demo user selected (registerUser skipped)', { authId, sessionId: options.sessionId });
  }

  // 3) login (acquire JWT).
  // 3) ログイン（JWT取得）。
  //
  // After login, the server sets the refresh cookie.
  // We capture the value and send it via header on refresh.
  // ログイン後、サーバは refresh cookie をセットする。
  // その値を保持して refresh 時にヘッダで送る。
  log('login start');
  const loginRes = await revlm.login(authId, password);
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.error || loginRes.reason}`);
  log('login ok');

  if (!options.skipRefresh) {
    // Wait for token expiration before refresh.
    // トークン期限切れを待ってからリフレッシュする。
    //
    // Why 2.5s:
    // - The server (spawned by example-cli test) configures jwtExpiresIn=2 seconds.
    // - Waiting slightly longer ensures the access token is expired.
    //
    // 2.5秒待つ理由:
    // - example-cli のテストでは server を jwtExpiresIn=2秒で起動している。
    // - 少し長めに待って確実に期限切れにする。
    log('sleep (waiting for token expiry)', { ms: 2500 });
    await sleep(2500);

    // 4) refresh token (header-based).
    // 4) トークン更新（ヘッダ方式）。
    //
    // refreshToken:
    // - Sends the expired access token in Authorization header.
    // - Sends refresh secret via x-revlm-refresh header.
    // - Receives a new access token (+ new refresh cookie) on success.
    //
    // refreshToken の挙動:
    // - 期限切れアクセストークンを Authorization で送る。
    // - refresh シークレットを x-revlm-refresh で送る。
    // - 成功時に新アクセストークン（+新 refresh cookie）を得る。
    log('refreshToken start');
    const refreshRes = await revlm.refreshToken();
    if (!refreshRes.ok) throw new Error(`refresh failed: ${refreshRes.error || refreshRes.reason}`);
    log('refreshToken ok');
  } else {
    log('refreshToken skipped (demo mode)');
  }

  // Optional post-refresh hook (used by `pnpm start`).
  // refresh 後の任意フック（`pnpm start` 用）。
  if (options.afterRefresh) {
    await options.afterRefresh({ revlm, usersDbName: options.usersDbName });
  }

  // 5) Collection access (Realm-like syntax).
  // 5) コレクションアクセス（Realm 風の書き味）。
  //
  // In the official docs, we want users to learn the recommended typing style:
  // - Use the compat namespace for MongoDB service types.
  //
  // 公式ドキュメントとしては、推奨の型付けを示したい：
  // - MongoDB service の型は compat 名前空間から参照する。
  type ExampleItem = { _id: unknown; name: string; value: number };
  const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<ExampleItem> =
    revlm.db(options.usersDbName).collection<ExampleItem>(DEFAULT_COLLECTION);

  // 6) insertOne via /revlm-gate (through the collection wrapper).
  // 6) insertOne（コレクションラッパー経由 = /revlm-gate 経由）。
  //
  // This verifies that after refresh, authenticated data operations succeed.
  // リフレッシュ後も認証つきDB操作が通ることを確認する。
  log('collection.insertOne start');
  const insertRes = await coll.insertOne({ name: 'cli-item', value: 1 } as any);
  log('collection.insertOne ok', { insertedId: (insertRes as any)?.insertedId });

  // 7) find via /revlm-gate (through the collection wrapper).
  // 7) find（コレクションラッパー経由 = /revlm-gate 経由）。
  //
  // This gives a visible, deterministic output for the demo.
  // デモとして確認しやすい決定的な結果（件数）を得る。
  log('collection.find start');
  const found = await coll.find({ name: 'cli-item' } as any);
  log('collection.find ok', { resultCount: Array.isArray(found) ? found.length : 0 });

  // 8) provisional user create/delete.
  // 8) 仮ユーザの作成/削除。
  const tempAuthId = 'prov-demo-user';
  const tempPassword = 'prov-demo-pass';
  log('provisionalLogin (temp user) start');
  const provisionalTemp = await revlm.provisionalLogin(options.provisionalAuthId);
  if (!provisionalTemp.ok) throw new Error(`provisional login failed: ${provisionalTemp.error || provisionalTemp.reason}`);
  log('provisionalLogin (temp user) ok');
  log('registerUser (temp user) start');
  const tempUser = { authId: tempAuthId, userType: 'user', roles: ['example'], name: 'Example Temp' };
  const registerTemp = await revlm.registerUser(tempUser, tempPassword);
  if (!registerTemp.ok) throw new Error(`registerUser failed: ${registerTemp.error || registerTemp.reason}`);
  log('registerUser (temp user) ok');
  log('login (temp user) start');
  const tempLogin = await revlm.login(tempAuthId, tempPassword);
  if (!tempLogin.ok) throw new Error(`login failed: ${tempLogin.error || tempLogin.reason}`);
  log('login (temp user) ok');
  log('deleteUser (temp user) start');
  const deleteTemp = await revlm.deleteUser({ authId: tempAuthId });
  if (!deleteTemp.ok) throw new Error(`deleteUser failed: ${deleteTemp.error || deleteTemp.reason}`);
  log('deleteUser (temp user) ok');

  return { authId, resultCount: Array.isArray(found) ? found.length : 0 };
}
