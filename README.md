# Revlm Monorepo

English documentation | [日本語ドキュメントはこちら](README-ja.md)  
[Revlm-Client Reference](docs/Revlm-Client-Reference.md)

Self-hosted alternative to MongoDB Realm App Services. This monorepo contains:

- `@kedaruma/revlm-server` – Express-based gateway that manages authentication and proxies MongoDB actions
- `@kedaruma/revlm-client` – TypeScript SDK for apps migrating from Realm to the Revlm server
- `@kedaruma/revlm-shared` – Shared types, auth helpers, and utilities

## Background

MongoDB Atlas is retiring App Services, so this project provides a drop-in, self-hosted replacement. It exposes:

- MongoDB connectivity (Atlas or self-managed)
- User authentication (password + provisional login)
- Realm-compatible client APIs to smooth migrations

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

## Getting Started

```bash
pnpm install
pnpm build
pnpm test
```

## Scripts

- `pnpm clean` – run each package’s clean script, then remove root-level `dist` / `node_modules`
- `pnpm install` – restore workspace dependencies
- `pnpm build` – build the entire monorepo
- `pnpm test` – run Jest suites package by package
- `pnpm pack:all` – run `pnpm pack` inside every workspace package to produce `.tgz` artifacts

## Demos

Some demos require starting the demo server beforehand. See each package README for details.

- [example-cli](packages/example-cli/README.md)  
  - CLI flow: register → login → token expiry → refresh → CRUD.
- [example-rn](packages/example-rn/README.md)  
  - React Native login/CRUD/refresh demo (local HTTPS required).
- [example-server](packages/example-server/README.md)  
  - Server startup and demo user/data initialization.
- [example-vue](packages/example-vue/README.md)  
  - Vue login/CRUD/refresh demo in the browser.

See each package README for detailed instructions.
