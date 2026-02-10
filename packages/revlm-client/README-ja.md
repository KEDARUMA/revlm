# @kedaruma/revlm-client

[English README](README.md)

MongoDB Realm から Revlm サーバーへ移行するアプリ向けの TypeScript/JavaScript SDK です。ユーザー認証や `/revlm-gate` 呼び出し、コレクション操作のヘルパーを提供します。

## インストール

```bash
pnpm add @kedaruma/revlm-client
```

CJS/ESM 両対応のバンドルと型定義が同梱されています。

## 使用例

```ts
import { Revlm } from '@kedaruma/revlm-client';

const randomBytes = (length: number) => {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
};

const revlm = new Revlm('https://your-server.example.com', { randomBytes });
const login = await revlm.login('user', 'secret');
const db = revlm.db('db_name');
const coll = db.collection<any>('collection_name');
const all = await coll.find({});

```

### React Native（Hermes）でのポリフィル

以下を依存に追加し、アプリのエントリ（`index.js` や `App.tsx` など）の先頭で一度だけ読み込みます。

```bash
pnpm add react-native-webcrypto react-native-get-random-values fast-text-encoding buffer
```

```ts
import '@kedaruma/revlm-client/rn-setup';
```

`crypto`（getRandomValues/subtle）、`TextEncoder`/`TextDecoder`、`Buffer` をベストエフォートで埋めます。RN 以外の環境で読み込んでも安全です。

## スクリプト

- `pnpm run build` – `tsup` でビルドします。
- `pnpm test` – Jest の統合テストを実行します（テスト用サーバーが必要）。
- `pnpm run clean` – ビルド成果物と `node_modules` を削除します。
