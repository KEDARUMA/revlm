# Example Vue

[English version](README.md)

Revlm サーバ向けの Vue デモクライアントです。

## Scripts

- `pnpm --filter @kedaruma/example-vue demo`: Vite 開発サーバを起動します

## Environment files

### .env.autorefresh
自動リフレッシュを有効にしたい場合は、次の preset を使います。

```
cp .env.autorefresh .env
```

`VITE_AUTO_REFRESH_ON_401=true` が有効になります。

## Start
前提: `packages/example-server` の `pnpm demo` が起動していること。

```
pnpm --filter @kedaruma/example-vue demo
```

## Runtime flow
1) Login ページ → デモアカウントでログイン
2) Demo ページ → revlm-gate 操作と検索

なお、トークンが失効するとloginページに遷移します。

## Environment variables

**Revlm サーバの接続先**<br>
VITE_REVLM_BASE_URL=https://localhost:4123

**ユーザDB名**<br>
VITE_USERS_DB_NAME=revlm

**マルチセッション用セッションID**<br>
VITE_VUE_REVLM_SESSION_ID=example-vue-session

**provisional login の有効化**<br>
VITE_PROVISIONAL_LOGIN_ENABLED=true

**provisional login の認証ID**<br>
VITE_PROVISIONAL_AUTH_ID=example-prov

**provisional login のマスターシークレット**<br>
VITE_PROVISIONAL_AUTH_SECRET_MASTER=example-master

**provisional login のドメイン**<br>
VITE_PROVISIONAL_AUTH_DOMAIN=example.domain

**401時の自動リフレッシュ**<br>
VITE_AUTO_REFRESH_ON_401=false

**ログレベル**<br>
VITE_LOG_LEVEL=debug
