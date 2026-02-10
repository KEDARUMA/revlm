# Example React Native

このパッケージは Revlm サーバ向けの React Native デモクライアントです。

[English version](README.md)

## Scripts

- `pnpm --filter @kedaruma/example-rn start`: Metro を起動します。
- `pnpm --filter @kedaruma/example-rn ios`: iOS で起動します。
- `pnpm --filter @kedaruma/example-rn android`: Android で起動します。
- `pnpm --filter @kedaruma/example-rn android:https:prep`: adb reverse の正規化 + Android証明書導入フローを実行します。
- `pnpm --filter @kedaruma/example-rn android:https`: 上記 prep の後に Android を起動します。
- `pnpm --filter @kedaruma/example-rn trust:ios-cert`: 起動中iOSシミュレータへ証明書を信頼登録します。
- `pnpm --filter @kedaruma/example-rn trust:android-cert`: Androidエミュレータへ証明書を送信してインストールします。

## Android 起動方法の変更
HTTPS デモの再現性を上げるため、Android の起動は `android` ではなく `android:https` を標準手順に変更しました。

- 以前: `pnpm --filter @kedaruma/example-rn android`
- 現在: `pnpm --filter @kedaruma/example-rn android:https`

`android:https` は以下をまとめて実行します。
- `adb reverse` の初期化と再設定（8081/4123）
- Android 証明書導入フロー（`trust:android-cert` 相当）
- `react-native run-android`

## Environment files

### .env.autorefresh
自動リフレッシュを有効にしたい場合は、以下のプリセットを使います。

```
cp .env.autorefresh .env
```

デフォルトの `.env` と同じ設定で、次の値だけ `true` になります。

```
AUTO_REFRESH_ON_401=true
```

## Start
前提: `packages/example-server` で `pnpm demo` を起動してください。

```
pnpm install
pnpm --filter @kedaruma/example-rn start
```

別ターミナルで:

```
pnpm --filter @kedaruma/example-rn ios
```

Android:

```
pnpm --filter @kedaruma/example-rn android
```

### Android HTTPS の再現手順（推奨）
初回セットアップ時や、環境差分でログインが不安定になった時はこの手順を使ってください。

ターミナル1（server）:
```
pnpm --filter @kedaruma/example-server demo
```

ターミナル2（Metro）:
```
pnpm --filter @kedaruma/example-rn start -- --reset-cache
```

ターミナル3（Android起動 + adb reverse + 証明書導入フロー）:
```
pnpm --filter @kedaruma/example-rn android:https
```

### 2回目以降の通常起動
以下を実行してください。

ターミナル1（server）:
```
pnpm --filter @kedaruma/example-server demo
```

ターミナル2（Metro）:
```
pnpm --filter @kedaruma/example-rn start
```

ターミナル3（Android）:
```
pnpm --filter @kedaruma/example-rn android:https
```

## RN polyfills（重要）
React Native には Node/ブラウザのポリフィルが標準ではありません。このデモでは `index.js` で
**アプリ読み込み前**に必ずポリフィルを適用しています。順序は次の通りです。

1) Buffer
2) crypto + getRandomValues
3) TextEncoder/TextDecoder
4) `@kedaruma/revlm-client/rn-setup`
5) App import

順序が崩れると次のようなエラーになります。
- `Property 'TextDecoder' doesn't exist`
- `BSON: For React Native please polyfill crypto.getRandomValues`

## Metro resolver 設定（重要）
pnpm はシンボリックリンクを使うため、Metro が依存を解決できないことがあります。
このデモでは `metro.config.js` で以下を行います。
- workspace の `node_modules` を解決パスに追加
- package `exports` を有効化
- `crypto` と `@kedaruma/revlm-shared` を明示マップ
- `fast-base64-decode` のCJS/ESM差異を避けるシムを使用

## シミュレータ向け HTTPS 設定（必須）
このデモは HTTPS（`https://localhost:4123`）を使用します。エミュレータ/シミュレータ側で証明書を信頼させてください。

前提: example-server 側で証明書を生成します。
```
pnpm --filter @kedaruma/example-server setup-https
```

### iOS シミュレータ
シミュレータ起動後に実行します:
```
pnpm --filter @kedaruma/example-rn trust:ios-cert
```

何度実行しても問題ありません。起動中のシミュレータを対象にします。
mkcert の root CA がある場合はそれを使用します（推奨）。

### Android エミュレータ
エミュレータ起動後に実行します:
```
pnpm --filter @kedaruma/example-rn trust:android-cert
```

インストール画面が表示されるので、案内に従って許可してください。

## Runtime flow
1) Login page → デモアカウントで認証。
2) Demo page → revlm-gate 操作と検索を実行。

## Environment variables

**Revlm サーバのベース URL**<br>
REVLM_BASE_URL=https://localhost:4123

**使用するデータベース名**<br>
USERS_DB_NAME=revlm

**マルチセッション用セッション ID**<br>
RN_REVLM_SESSION_ID=example-rn-session

**仮ログインを有効化**<br>
PROVISIONAL_LOGIN_ENABLED=true

**仮ログインの認証 ID**<br>
PROVISIONAL_AUTH_ID=example-prov

**仮ログインのマスターシークレット**<br>
PROVISIONAL_AUTH_SECRET_MASTER=example-master

**仮ログインのドメイン**<br>
PROVISIONAL_AUTH_DOMAIN=example.domain

**401 時の自動リフレッシュ**<br>
AUTO_REFRESH_ON_401=true

**クライアントのログレベル**<br>
LOG_LEVEL=debug
