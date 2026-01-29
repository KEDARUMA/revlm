import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import type { CookieStore } from '@kedaruma/revlm-client/revlm-compat';
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
};

// Simple wait helper for token expiration timing.
// トークン期限切れを待つための簡易スリープ。
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory cookie store for demo environments (Node/CLI).
// CLI環境向けのインメモリCookie保存。
//
// Why this exists:
// - revlm-server uses an HttpOnly cookie (`revlm_refresh`) for refresh-token.
// - In browsers, cookies are managed automatically.
// - In Node/CLI, `fetch` does NOT automatically persist cookies.
// - So we emulate the minimal browser behavior: store `Set-Cookie` and send `Cookie` on next requests.
//
// 目的:
// - revlm-server は refresh-token のために HttpOnly cookie（`revlm_refresh`）を使う。
// - ブラウザではCookieが自動で管理される。
// - Node/CLI では `fetch` がCookieを自動保持しない。
// - そのため最小限のブラウザ挙動（Set-Cookie保存→次リクエストでCookie送信）を再現する。
function createInMemoryCookieStore(): CookieStore {
  const jar = new Map<string, string>();
  return {
    getCookieHeader: () => {
      if (!jar.size) return undefined;
      return Array.from(jar.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    },
    setCookie: (_url, setCookieHeader) => {
      const [cookiePair] = setCookieHeader.split(';');
      const sep = cookiePair.indexOf('=');
      if (sep === -1) return;
      const name = cookiePair.slice(0, sep).trim();
      const value = cookiePair.slice(sep + 1).trim();
      if (!name) return;
      jar.set(name, value);
    },
  };
}

export async function runExampleFlow(options: FlowOptions) {
  // Human-friendly progress markers for demo output.
  // デモ出力として分かりやすい進捗ログ。
  const log = (...args: any[]) => console.log('[example-cli]', ...args);

  // Prepare client + cookie store for refresh-token support.
  // refresh-token対応のためCookieStore付きでクライアントを作成。
  //
  // Note:
  // - `sessionId` is REQUIRED by the server for login/refresh in the current design.
  // - CLI uses a fixed sessionId by default (easy reproducibility in demos).
  //
  // 注意:
  // - 現設計では server 側が login/refresh で `sessionId` を必須としている。
  // - CLI ではデモの再現性を優先して固定 sessionId を使う。
  const cookieStore = createInMemoryCookieStore();
  const revlm = new Revlm(options.baseUrl, {
    provisionalEnabled: true,
    provisionalAuthSecretMaster: options.provisionalAuthSecretMaster,
    provisionalAuthDomain: options.provisionalAuthDomain,
    autoSetToken: true,
    autoRefreshOn401: false,
    sessionId: options.sessionId,
    cookieStore,
    logLevel: 'info',
  });

  // Create a fresh user for demonstration.
  // デモ用の新規ユーザを作成。
  const authId = `example-cli-${Date.now()}`;
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

  // 3) login (acquire JWT).
  // 3) ログイン（JWT取得）。
  //
  // After login, the server also sets the refresh cookie.
  // The cookieStore captures it via Set-Cookie.
  // ログイン後、サーバは refresh cookie もセットする。
  // cookieStore が Set-Cookie からそれを保持する。
  log('login start');
  const loginRes = await revlm.login(authId, DEFAULT_PASSWORD);
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.error || loginRes.reason}`);
  log('login ok');

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

  // 4) refresh token (uses cookie store).
  // 4) トークン更新（CookieStore利用）。
  //
  // refreshToken:
  // - Sends the expired access token in Authorization header.
  // - Sends the refresh secret cookie from cookieStore in Cookie header.
  // - Receives a new access token (+ new refresh cookie) on success.
  //
  // refreshToken の挙動:
  // - 期限切れアクセストークンを Authorization で送る。
  // - cookieStore の refresh cookie を Cookie で送る。
  // - 成功時に新アクセストークン（+新 refresh cookie）を得る。
  log('refreshToken start');
  const refreshRes = await revlm.refreshToken();
  if (!refreshRes.ok) throw new Error(`refresh failed: ${refreshRes.error || refreshRes.reason}`);
  log('refreshToken ok');

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

  return { authId, resultCount: Array.isArray(found) ? found.length : 0 };
}
