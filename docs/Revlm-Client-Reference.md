# Revlm-Client Reference (English)

[日本語リファレンス](Revlm-Client-Reference-ja.md)

This document describes the public API of `@kedaruma/revlm-client` (overview + key methods).  
The API is intentionally close to Realm SDK to make migration straightforward.

## Supported Environments

- Browser / Node.js / React Native
- Browsers manage cookies automatically
- Node/RN must provide `cookieStore` to receive/send cookies

## Install

```bash
pnpm add @kedaruma/revlm-client
```

## Core Classes

### Revlm

#### Construct

```ts
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';

const revlm = new Revlm('https://localhost:4123', {
  sessionId: 'example-session',
});
```

#### RevlmOptions

- `fetchImpl?: typeof fetch`  
  Override fetch implementation
- `defaultHeaders?: Record<string, string>`  
  Headers added to every request
- `provisionalEnabled?: boolean`  
  Enable provisional login flow
- `provisionalAuthSecretMaster?: string`  
  Master secret for provisional login
- `provisionalAuthDomain?: string`  
  Auth domain for provisional login
- `autoSetToken?: boolean`  
  Automatically store token from login/provisionalLogin
- `autoRefreshOn401?: boolean`  
  Auto refresh once on 401 and retry
- `logLevel?: 'error' | 'warn' | 'info' | 'debug'`  
  Logging level
- `sessionId?: string`  
  Fixed `x-revlm-session-id`
- `sessionIdProvider?: () => string | Promise<string>`  
  Dynamic session id provider
- `cookieStore?: CookieStore`  
  Required for Node/RN cookie handling

#### CookieStore

```ts
export type CookieStore = {
  getCookieHeader: (url: string) => string | undefined | Promise<string | undefined>;
  setCookie: (url: string, setCookieHeader: string) => void | Promise<void>;
};
```

Node/RN must support `/cookie-check` via `cookieStore`.  
Even with header-based refresh, you still need cookie-check support.

#### Methods

- `login(authId: string, password: string)`
- `provisionalLogin(authId: string)`
- `registerUser(user: UserInput, password: string)`
- `deleteUser(params: { _id?: any; authId?: string })`
- `refreshToken()`
- `verifyToken()`
- `setToken(token: string)` / `getToken()` / `clearToken()` / `logout()`
- `revlmGate(payload: any)`
- `db(dbName: string)`

### RevlmDBDatabase

- `collection<T>(name: string): MdbCollection<T>`

### MdbCollection

These methods **throw on failure**.  
Check `err.response` for `{ ok, status, error | reason }`.

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
- `watch(options?)` (simple implementation)

## Example (login → find)

```ts
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';

const revlm = new Revlm('https://localhost:4123', {
  sessionId: 'example-session',
});

await revlm.login('demo', 'demo-pass');
const coll = revlm.db('revlm').collection('demo_items');
const docs = await coll.find({});
```

## Example (refresh)

```ts
const loginRes = await revlm.login('demo', 'demo-pass');
if (!loginRes.ok) throw new Error('login failed');

await new Promise((resolve) => setTimeout(resolve, 2500));

const refreshRes = await revlm.refreshToken();
if (!refreshRes.ok) throw new Error('refresh failed');
```

## Example (CRUD)

```ts
type Item = { _id: unknown; name: string; value: number };
const coll = revlm.db('revlm').collection<Item>('demo_items');

await coll.insertOne({ name: 'a', value: 1 });
const docs = await coll.find({});
await coll.updateOne({ name: 'a' }, { $set: { value: 2 } });
await coll.deleteOne({ name: 'a' });
```

## Error Handling

`login`/`refreshToken` return `ok` in the response.  
`MdbCollection` methods throw; check `err.response`.

