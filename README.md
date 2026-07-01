<p align="center">
  <img src="docs/logo.png" alt="Revlm logo" width="320">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kedaruma/revlm-server"><img src="https://img.shields.io/npm/v/@kedaruma/revlm-server?label=server" alt="server npm version"></a>
  <a href="https://www.npmjs.com/package/@kedaruma/revlm-client"><img src="https://img.shields.io/npm/v/@kedaruma/revlm-client?label=client" alt="client npm version"></a>
  <a href="https://www.npmjs.com/package/@kedaruma/revlm-shared"><img src="https://img.shields.io/npm/v/@kedaruma/revlm-shared?label=shared" alt="shared npm version"></a>
  <a href="https://github.com/kedaruma/revlm/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-ISC-blue" alt="license"></a>
  <img src="https://img.shields.io/badge/TypeScript-Ready-3178c6" alt="TypeScript ready">
</p>

# Revlm

English documentation | [日本語ドキュメントはこちら](README-ja.md)  

A self-hosted TypeScript gateway for MongoDB apps migrating from Realm App Services.

Revlm gives web, mobile, and React Native apps a Realm-like client API backed by your own MongoDB and server infrastructure. It handles password authentication, provisional login, JWT sessions, refresh tokens, and authenticated MongoDB CRUD calls through a small Express gateway.

## Quick Start

Install the client SDK in your app:

```bash
pnpm add @kedaruma/revlm-client
```

Use the Realm-compatible client surface:

```ts
import { Revlm } from '@kedaruma/revlm-client/revlm-compat';

const revlm = new Revlm('https://your-server.example.com', {
  sessionId: 'your-session-id',
});

await revlm.login('user@example.com', 'password');

const users = revlm.db('app').collection('users');
const docs = await users.find({});
```

To try the repository locally with the example server and in-memory MongoDB:

```bash
pnpm install
pnpm run build:packages
pnpm --filter @kedaruma/example-cli test
```

For browser and React Native demos, see the package README files under [`packages/`](packages).

## What Revlm Provides

- Replace MongoDB Realm App Services with a self-hosted TypeScript server.
- Keep a Realm-like client API for easier migration.
- Use MongoDB from web and mobile apps through an authenticated gateway.
- Support password authentication, provisional login, JWT, and refresh token flows.
- Run on your own infrastructure instead of depending on a hosted app-service layer.

## Scope and Compatibility

Revlm is focused on the parts of Realm App Services that are commonly needed when moving application traffic back to your own infrastructure:

- Realm-style login and session handling
- authenticated collection access from TypeScript, browser, and React Native clients
- refresh-token based session continuity
- local demos for CLI, Vue, and React Native clients

Revlm is not a full clone of every Atlas App Services feature. Functions, triggers, sync, hosting, and other managed App Services features should be replaced with your own backend code or infrastructure.

## Used in Production

Revlm is used in production by [Fukkarubaito](https://apps.apple.com/jp/app/%E3%83%95%E3%83%83%E3%82%AB%E3%83%AB%E3%83%90%E3%82%A4%E3%83%88/id6748752464), a Japanese part-time job search app that maps and notifies users about job listings across Japan.

- Searches roughly 250,000 part-time job listings by user-selected conditions.
- Stores job data in MongoDB using a 3-shard sharded cluster.
- Runs real-time searches and maps matching listings as markers.
- Sends notifications based on user-selected job conditions.
- Available on [iOS](https://apps.apple.com/jp/app/%E3%83%95%E3%83%83%E3%82%AB%E3%83%AB%E3%83%90%E3%82%A4%E3%83%88/id6748752464) and [Android](https://play.google.com/store/apps/details?id=jp.co.umore.app.footlight&hl=ja).

## Who Is This For?

Revlm is useful if you:

- previously used MongoDB Realm Web SDK or Atlas App Services;
- want to keep MongoDB behind your own API server;
- need authentication and refresh-token handling around MongoDB access;
- are building a TypeScript, React Native, Vue, or CLI app backed by MongoDB;
- want a small self-hosted alternative instead of a large backend framework.

## Packages

This monorepo contains:

- `@kedaruma/revlm-server` – Express-based gateway that manages authentication and proxies MongoDB actions
- `@kedaruma/revlm-client` – TypeScript SDK for apps migrating from Realm to the Revlm server
- `@kedaruma/revlm-shared` – Shared types, auth helpers, and utilities

## Realm Migration Example

<table>
  <thead>
    <tr>
      <th>Revlm (Target)</th>
      <th>Realm (Source)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <pre><code class="language-ts">import { Revlm } from '@kedaruma/revlm-client/revlm-compat';<br>
<br>
const revlm = new Revlm('https://localhost:4123', {<br>
  sessionId: 'example-session',<br>
});<br>
<br>
await revlm.login('demo', 'demo-pass');<br>
const coll = revlm.db('revlm').collection('demo_items');<br>
const docs = await coll.find({});<br>
</code></pre>
      </td>
      <td>
        <pre><code class="language-ts">import { App, Credentials } from 'realm-web';<br>
<br>
const app = new App({ id: 'your-app-id' });<br>
await app.logIn(Credentials.emailPassword('demo', 'demo-pass'));<br>
const mongo = app.currentUser.mongoClient('mongodb-atlas');<br>
const coll = mongo.db('revlm').collection('demo_items');<br>
const docs = await coll.find({});<br>
</code></pre>
      </td>
    </tr>
  </tbody>
</table>

## [Revlm-Client Reference](docs/Revlm-Client-Reference.md)

## Demos

These demos can be run after building. Some require starting the demo server first, so check each package README.
For the React Native demo, Xcode and Android Studio must be installed in advance.

- [example-server](packages/example-server/README.md)
  - Start the server and run demo initialization.
- [example-cli](packages/example-cli/README.md)
  - CLI flow: register → login → token expiry → refresh → CRUD.
- [example-vue](packages/example-vue/README.md)
  - Vue login/CRUD/refresh demo in the browser.
- [example-rn](packages/example-rn/README.md)
  - React Native login/CRUD/refresh demo (local HTTPS required).

## Server Body Size Settings

The Revlm server supports two optional environment variables for request body sizing, both of which can be set in a `.env` file.

- `BODY_LIMIT` limits accepted `application/ejson` and JSON request bodies. If omitted, it defaults to `1mb`.
- `BODY_WARN_THRESHOLD` only emits a warning log when the request body exceeds the threshold. If omitted, it defaults to `100kb`.

See [packages/revlm-server/README.md](packages/revlm-server/README.md) and [packages/example-server/README.md](packages/example-server/README.md) for concrete configuration examples.
