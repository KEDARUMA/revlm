# Revlm-Client リファレンス（日本語）

[English Reference](Revlm-Client-Reference.md)

`@kedaruma/revlm-client` の API 仕様（概要 + 主要メソッド）です。  
Realm SDK からの移植を意識し、MongoDB 操作を近い書き味で提供します。

## 対象環境

- ブラウザ / Node.js / React Native
- ブラウザは Cookie を自動管理します
- Node/RN は `cookieStore` を用意して Cookie を受け取り/送信してください

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
  独自 fetch を差し替える場合に指定
- `defaultHeaders?: Record<string, string>`  
  すべてのリクエストに追加するヘッダ
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
- `cookieStore?: CookieStore`  
  Node/RN での Cookie 受け取り/送信を行うストア

#### CookieStore

```ts
export type CookieStore = {
  getCookieHeader: (url: string) => string | undefined | Promise<string | undefined>;
  setCookie: (url: string, setCookieHeader: string) => void | Promise<void>;
};
```

Node/RN では `/cookie-check` を通すために `cookieStore` が必要です。  
refresh をヘッダ方式にする場合でも、最低限 `/cookie-check` に対応してください。

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
