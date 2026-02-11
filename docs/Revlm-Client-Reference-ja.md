# Revlm-Client リファレンス（日本語）

[English Reference](Revlm-Client-Reference.md)

`@kedaruma/revlm-client` の API 仕様（概要 + 主要メソッド）です。  
Realm SDK からの移植を意識し、MongoDB 操作を近い書き味で提供します。

## 対象環境

- ブラウザ / Node.js / React Native
- `fetchImpl` は省略可能で、未指定時は `globalThis.fetch` を自動利用します
- Node.js は v18+ なら組み込み `fetch` が使えます（それ未満は `fetchImpl` を明示指定）
- `/cookie-check` で cookie モードを判定し、使えない場合はヘッダ refresh モードへ自動フォールバックします

## インストール

```bash
pnpm add @kedaruma/revlm-client
```

## 主要クラス

### Revlm

#### 生成

```ts
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';

const revlm = new Revlm('https://localhost:4123', {
  sessionId: 'example-session',
});
```

#### RevlmOptions

- `fetchImpl?: typeof fetch`  
  独自 fetch を差し替える場合に指定（任意）
- `defaultHeaders?: Record<string, string>`  
  すべてのリクエストに追加するヘッダ
- `stateStore?: RevlmStateStore`  
  ヘッダ refresh モードで使う refresh secret の永続化ストア（任意）
- `provisionalEnabled?: boolean`  
  仮ログイン機能の有効化
- `provisionalAuthSecretMaster?: string`  
  仮ログイン用の master secret
- `provisionalAuthDomain?: string`  
  仮ログイン用の auth domain
- `autoSetToken?: boolean`  
  `login` / `provisionalLogin` の token を自動設定
- `autoRefreshOn401?: boolean`  
  401 時に refresh を自動で1回実行
- `logLevel?: 'error' | 'warn' | 'info' | 'debug'`  
  ログ出力レベル
- `sessionId?: string`  
  送信ヘッダ `x-revlm-session-id` の固定値
- `sessionIdProvider?: () => string | Promise<string>`  
  動的な sessionId 供給

#### RevlmStateStore

```ts
export type RevlmStateStore = {
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};
```

`stateStore` は任意ですが、Node/RN でヘッダ refresh フォールバックを使う場合は推奨です。  
未指定の場合はプロセス寿命のメモリ内だけで refresh secret を保持します。

#### 乱数に関する注意（provisional login）

`provisionalLogin()` は `@kedaruma/revlm-shared` の `AuthClient` を使います。  
セキュリティ面を重視する場合は、アプリ起動時に `initRandomBytes()` を暗号学的に安全な乱数源で初期化してください。  
shared 側のフォールバック乱数は互換性用であり、本番のセキュリティ用途には非推奨です。

#### メソッド

- `login(authId: string, password: string)`  
  ユーザログイン
- `provisionalLogin(authId: string)`  
  仮ログイン（`provisionalEnabled` 必須）
- `registerUser(user: UserInput, password: string)`  
  ユーザ作成
- `deleteUser(params: { _id?: any; authId?: string })`  
  ユーザ削除
- `refreshToken()`  
  refresh-token を実行（成功時は token を更新）
- `verifyToken()`  
  トークン検証（不正なら token をクリア）
- `setToken(token: string)` / `getToken()` / `clearToken()` / `logout()`  
  token の手動操作
- `revlmGate(payload: any)`  
  低レベル API（直接 /revlm-gate へ送信）
- `db(dbName: string)`  
  DB ハンドル取得

### RevlmDBDatabase

- `collection<T>(name: string): MdbCollection<T>`  
  コレクション取得

### MdbCollection

以下のメソッドは **失敗時に例外を投げます**。  
例外の `response` に `{ ok, status, error | reason }` が入ります。

- `find(filter?, options?)`
- `findOne(filter?, options?)`
- `findOneAndUpdate(filter, update, options?)`
- `findOneAndReplace(filter, replacement, options?)`
- `findOneAndDelete(filter?, options?)`
- `aggregate(pipeline)`
- `count(filter?, options?)`
- `insertOne(document)`
- `insertMany(documents)`
- `deleteOne(filter?)`
- `deleteMany(filter?)`
- `updateOne(filter, update, options?)`
- `updateMany(filter, update, options?)`
- `watch(options?)` （簡易実装）

## 例（login → find）

```ts
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';

const revlm = new Revlm('https://localhost:4123', {
  sessionId: 'example-session',
});

await revlm.login('demo', 'demo-pass');
const coll = revlm.db('revlm').collection('demo_items');
const docs = await coll.find({});
```

## 例（refresh）

```ts
const loginRes = await revlm.login('demo', 'demo-pass');
if (!loginRes.ok) throw new Error('login failed');

// 期限切れ待ち
await new Promise((resolve) => setTimeout(resolve, 2500));

const refreshRes = await revlm.refreshToken();
if (!refreshRes.ok) throw new Error('refresh failed');
```

## 例（CRUD）

```ts
type Item = { _id: unknown; name: string; value: number };
const coll = revlm.db('revlm').collection<Item>('demo_items');

await coll.insertOne({ name: 'a', value: 1 });
const docs = await coll.find({});
await coll.updateOne({ name: 'a' }, { $set: { value: 2 } });
await coll.deleteOne({ name: 'a' });
```

## エラーの扱い

`login`/`refreshToken` などは **戻り値で ok を判定**します。  
`MdbCollection` 系は **例外を投げる**ため、`try/catch` で `err.response` を確認してください。
