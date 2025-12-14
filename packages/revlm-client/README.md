# @kedaruma/revlm-client

English documentation | [日本語ドキュメントはこちら](README-ja.md)

TypeScript/JavaScript SDK for apps migrating from MongoDB Realm to the self-hosted Revlm server. It exposes helpers to authenticate users, call `/revlm-gate`, and manage collections.

## Installation

```bash
pnpm add @kedaruma/revlm-client
```

The package ships both CJS and ESM bundles plus typings (`types` and `exports` are configured).

## Usage

```ts
import { Revlm } from '@kedaruma/revlm-client';

const revlm = new Revlm({ baseUrl: 'https://your-server.example.com' });
const login = await revlm.login({ authId: 'user', password: 'secret' });
const db = revlm.db('db_name');
const coll = db.collection<any>('collection_name');
const all = await coll.find({});
```

### React Native (Hermes) polyfills

Install RN-friendly crypto/text/Buffer polyfills and load the helper once at app startup (e.g. in `index.js` or `App.tsx`):

```bash
pnpm add react-native-webcrypto react-native-get-random-values fast-text-encoding buffer
```

```ts
import '@kedaruma/revlm-client/rn-setup';
```

The helper makes a best-effort attempt to wire `crypto`, `crypto.getRandomValues`, `crypto.subtle`, `TextEncoder`/`TextDecoder`, and `Buffer`. It is safe to import on non-RN platforms.

## Scripts

- `pnpm run build` – bundle with `tsup`
- `pnpm test` – run Jest suites (server package must be running in test mode)
- `pnpm run clean` – remove build artifacts and `node_modules`
