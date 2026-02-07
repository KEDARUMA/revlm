# Revlm Monorepo

English documentation | [日本語ドキュメントはこちら](README-ja.md)  

Self-hosted alternative to MongoDB Realm App Services. This monorepo contains:

- `@kedaruma/revlm-server` – Express-based gateway that manages authentication and proxies MongoDB actions
- `@kedaruma/revlm-client` – TypeScript SDK for apps migrating from Realm to the Revlm server
- `@kedaruma/revlm-shared` – Shared types, auth helpers, and utilities

## Background

This project provides a drop-in, self-hosted replacement for MongoDB Realm App Services. It supports password authentication and provisional login, and offers a Realm-compatible API to minimize migration effort.

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
