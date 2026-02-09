# @kedaruma/revlm-shared

[English README](README.md)

revlm-server と revlm-client が共用する TypeScript 型定義、BSON ヘルパー、認証ユーティリティをまとめたパッケージです。

## 内容

- `models/` – ユーザーや MongoDB ドキュメントの型定義
- `auth-token` – 仮ログインで使う HKDF + AES-GCM のトークンユーティリティ
- `utils/asserts` – `ensureDefined` などのランタイムアサーション

## 仮ログイン用の乱数注入（AuthClient）

`AuthClient` は `randomBytes` を外部注入できます。プラットフォームの乱数源を明示的に指定してください。

## プラットフォーム別必須モジュール

`randomBytes` を指定しない場合、以下の乱数源が必要です。

- Web: `globalThis.crypto.getRandomValues`
- Node/Express: `crypto.randomBytes`（Node の組み込み）
- React Native: `react-native-get-random-values`（`global.crypto.getRandomValues` の注入）

### Web

```ts
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';

const randomBytes = (length: number) => {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
};

const client = new AuthClient({
  secretMaster: 'example-master',
  authDomain: 'example.domain',
  randomBytes,
});
```

### Express / Node

```ts
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';
import { randomBytes as nodeRandomBytes } from 'crypto';

const client = new AuthClient({
  secretMaster: 'example-master',
  authDomain: 'example.domain',
  randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
});
```

### React Native

```ts
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';
import 'react-native-get-random-values';

const randomBytes = (length: number) => {
  const out = new Uint8Array(length);
  (global.crypto as any).getRandomValues(out);
  return out;
};

const client = new AuthClient({
  secretMaster: 'example-master',
  authDomain: 'example.domain',
  randomBytes,
});
```

### CLI

```ts
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';
import { randomBytes as nodeRandomBytes } from 'crypto';

const client = new AuthClient({
  secretMaster: 'example-master',
  authDomain: 'example.domain',
  randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
});
```

### 参考: 別の乱数実装（非推奨）

暗号用途では**推奨しません**。デモ用途などでのみ検討してください。

```ts
const xorshift32 = (() => {
  let x = 88675123;
  return () => {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return x >>> 0;
  };
})();

const weakRandomBytes = (length: number) => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = xorshift32() & 0xff;
  }
  return out;
};

const client = new AuthClient({
  secretMaster: 'example-master',
  authDomain: 'example.domain',
  randomBytes: weakRandomBytes,
});
```

## ビルド

```bash
pnpm install
pnpm run build
```

`pnpm run build` を実行すると `src` が `dist` にコンパイルされ、他パッケージが参照できる `.d.ts` が出力されます。
