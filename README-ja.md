# Revlm モノレポ概要

[English README](README.md)  

このプロジェクトは、MongoDB Atlas が App Services を廃止する流れを受け、セルフホストで代替手段を提供することを目的としています。次の 3 パッケージで構成されます。

- `@kedaruma/revlm-server`：Express ベースのゲートウェイで、ユーザー認証と MongoDB CRUD の仲介を担います。
- `@kedaruma/revlm-client`：Web/モバイルアプリからサーバーへ接続する TypeScript SDK です。
- `@kedaruma/revlm-shared`：サーバー/クライアントが共用する型定義やユーティリティ群です。

## 背景と目的

MongoDB Atlas や自前の MongoDB インスタンスと安全に接続しつつ、Realm SDK を使ったアプリを最小限のコード変更で移行できることを目指しています。パスワード認証・仮ログインの両方に対応し、Realm ライクな API を提供します。

<table>
  <thead>
    <tr>
      <th>Revlm（移植先）</th>
      <th>Realm（移植元）</th>
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

## [Revlm-Client リファレンス](docs/Revlm-Client-Reference-ja.md)

## デモ一覧

ビルドすることで動作可能なデモを用意しています。
各デモは、事前にデモサーバーの起動が必要な場合がありますので、該当パッケージの README を確認してください。
また、React Native のデモを実行するには、あらかじめ Xcode および Android Studio がインストールされている必要があります。
- [example-server](packages/example-server/README-ja.md)
  - サーバ起動とデモ用サーバを実行します。
- [example-cli](packages/example-cli/README-ja.md)
  - CLI でユーザー登録 → ログイン → トークン期限切れ → refresh → CRUD を確認します。
- [example-vue](packages/example-vue/README-ja.md)
  - Vue でログイン/CRUD/refresh を確認します（ブラウザ動作）。
- [example-rn](packages/example-rn/README-ja.md)
  - React Native でログイン/CRUD/refresh を確認します（ローカル HTTPS 前提）。
