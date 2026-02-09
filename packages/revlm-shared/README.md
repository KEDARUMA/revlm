# @kedaruma/revlm-shared

English documentation | [日本語ドキュメントはこちら](README-ja.md)

Shared TypeScript declarations, BSON helpers, and auth utilities consumed by both the Revlm server and client packages.

## Contents

- `models/` – user and MongoDB document types
- `auth-token` – HKDF + AES-GCM token utilities used for provisional login
- `utils/asserts` – runtime `ensureDefined` and related helpers

## Random source injection (AuthClient)

`AuthClient` accepts `randomBytes` so you can plug in the platform RNG explicitly.

## Required modules by platform

If you do not pass `randomBytes`, the following random sources are required:

- Web: `globalThis.crypto.getRandomValues`
- Node/Express: `crypto.randomBytes` (built-in)
- React Native: `react-native-get-random-values` (injects `global.crypto.getRandomValues`)

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

### Alternative RNG example (not recommended)

Not suitable for cryptographic use. Consider only for demos.

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

## Build

```bash
pnpm install
pnpm run build
```

Running `pnpm run build` compiles `src` to `dist` with `.d.ts` outputs so the other packages can consume them via project references.
