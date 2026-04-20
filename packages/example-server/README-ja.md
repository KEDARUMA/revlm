# Example Server

[English version](README.md)

このパッケージはローカル開発・テスト用の最小構成サンプルです。`.env`（または `EXAMPLE_SERVER_ENV` で指定したファイル）から設定を読み込み、In Memory MongoDB を起動します。

## Scripts

- `pnpm --filter @kedaruma/example-server start`: サーバを起動します。
- `pnpm --filter @kedaruma/example-server start-with-opts -- --port 4123`: CLI オプションで上書きして起動します。（demo / test用）
- `pnpm --filter @kedaruma/example-server stop`: サーバを停止します（`.example-server.pid` を使用）。
- `pnpm --filter @kedaruma/example-server setup-https`: mkcert でローカル証明書を作成します。
- `pnpm --filter @kedaruma/example-server reset-data`: サンプルデータを削除して再作成します。

`start / demo` は `.example-server.pid` を書き込むので、`stop` で安全に停止できます。（^Cでも停止できる）

## HTTPS proxy（ローカルブラウザ用）
クライアントがブラウザの場合、HTTPS は必須となります。
example-server は ローカルの HTTPS プロキシを起動し、受信したリクエストを HTTP バックエンドへ転送します。
バックエンド側の構成は変更せず、プロキシ側で TLS を終端します。
本構成は デバッグ用途を想定したものであり、実運用時には Nginx や Apache などの HTTP サーバで TLS 終端を行う構成としてください。

### 1) 証明書の準備（mkcert）
ローカル証明書を信頼させるために mkcert を使います。

例（リポジトリルートで実行）:
```
pnpm --filter @kedaruma/example-server setup-https
```

手動で行う場合:
```
mkdir -p packages/example-server/.certs
mkcert -install
mkcert -key-file packages/example-server/.certs/localhost-key.pem \
  -cert-file packages/example-server/.certs/localhost.pem \
  localhost 127.0.0.1 ::1
```

作成されるファイル:
- `packages/example-server/.certs/localhost-key.pem`
- `packages/example-server/.certs/localhost.pem`

### 1.5) React Native（シミュレータ）
React Native デモは HTTPS を使うため、エミュレータ/シミュレータ側で証明書を信頼させてください。
端末を起動した状態で、`packages/example-rn` の補助スクリプトを実行します。

```
pnpm --filter @kedaruma/example-rn trust:ios-cert
pnpm --filter @kedaruma/example-rn trust:android-cert
```

iOS については、起動中のシミュレータ全てに mkcert の root CA を登録します。
別の端末を起動した場合は、再度実行してください。

### 2) .env.proxy で proxy 設定
proxy は以下の環境変数を利用します（すべて任意）:
- `EXAMPLE_PROXY_HTTPS_PORT`（HTTPS 待受ポート）
- `EXAMPLE_PROXY_TARGET_PORT`（HTTP 転送先ポート）
- `EXAMPLE_PROXY_KEY_FILE`（既定: `packages/example-server/.certs/localhost-key.pem`）
- `EXAMPLE_PROXY_CERT_FILE`（既定: `packages/example-server/.certs/localhost.pem`）
- `EXAMPLE_PROXY_CA_FILE`（任意）

例:
```
EXAMPLE_PROXY_ENV=.env.proxy
EXAMPLE_PROXY_HTTPS_PORT=44123
EXAMPLE_PROXY_TARGET_PORT=4122
```

proxy 設定ファイルのパスは `EXAMPLE_PROXY_ENV` で上書きできます。

### 3) 起動（proxy は自動）
```
pnpm --filter @kedaruma/example-server start
```

起動されるもの:
- HTTP バックエンド（revlm-server）
- HTTPS proxy（TLS 終端して HTTP に転送）

### 4) アクセス
HTTPS でアクセスします:
```
https://127.0.0.1:<EXAMPLE_PROXY_HTTPS_PORT>
```

`127.0.0.1` 以外のホスト名を使う場合は、mkcert の生成時に追加してください。

## 環境変数（.env.start を参考）

# Atlas の例
# MONGO_URI=mongodb+srv://<USER_ID>:<PASSWORD>@???.mongodb.net/?appName=???

# Local MongoDB の例
# MONGO_URI=mongodb://localhost:27017
MONGO_URI=<MUST BE SPECIFIED>

# 使用データベース名
USERS_DB_NAME=revlm

# ユーザコレクション名（ユーザー情報を格納します）
USERS_COLLECTION_NAME=users

# アクセストークンに署名するための秘密鍵
JWT_SECRET=example-secret

# リフレッシュ用の短命トークン署名するための秘密鍵
REFRESH_SECRET_SIGNING_KEY=example-refresh-secret

# 動作するポート(HTTP)
PORT=4122

# アプリが動作しているURLを指定する（CORS設定などで使用）カンマ区切りで複数の記述が可能
#CORS_ORIGIN=https://xxx.yyy.zzz

# HTTPデモ用にSecure属性を無効化（HTTPSでは true または未設定）。
COOKIE_SECURE=true

# SameSite設定（none|lax|strict）。ブラウザのクロスサイトデモは "none" 推奨。
COOKIE_SAMESITE=none

# [Provisional Login] は、Revlm-Server が暫定的な認証情報（provisional credentials）を利用して、
# 初期アカウントおよびユーザの作成を許可するための機構です。

# Provisional Login の有効／無効を指定
PROVISIONAL_LOGIN_ENABLED=true

# Provisional Login で使用する暫定認証ID
PROVISIONAL_AUTH_ID=example-prov

# Provisional Login で使用するマスターシークレット
PROVISIONAL_AUTH_SECRET_MASTER=example-master

# Provisional Login で使用するドメイン
PROVISIONAL_AUTH_DOMAIN=example.domain

# Access Token の有効期限（秒単位）
JWT_EXPIRES_IN=600

# リフレッシュトークンが期限切れになった後、追加で許容される猶予時間（秒）
# この期間内であれば、期限切れ後でもリフレッシュ可能
# 0 を指定した場合無期限となる
REFRESH_WINDOW_SEC=300

# REFRESH_SECRET_SIGNING_KEY の有効期間（秒）
# この時間を過ぎるとシークレットそのものが廃棄され、リフレッシュ不能となる
# 0 を指定した場合無期限となる
REFRESH_SECRET_TTL_SEC=300

# REFRESH_SECRET_TTL_SEC=0、REFRESH_WINDOW_SEC=0 とし、Revlm-Client の autoRefreshOn401=true を設定することで、
# アクセストークンの有効期限を意識せずに運用できます。スマートフォンアプリなどで有効です。

# `application/ejson` と JSON のリクエスト本体の最大サイズ
# `.env` で指定可能
# これを超えると PayloadTooLargeError が発生する
# 未指定時は `1mb`
BODY_LIMIT=1mb

# 保存されたセッション情報の有効期間（秒）
# 0 を指定した場合無期限となる
REFRESH_SESSION_TTL_SEC=2592000

# リクエスト本体がこのしきい値を超えると、警告ログ（WARN）を出す
# `.env` で指定可能
# 未指定時は `100kb`
BODY_WARN_THRESHOLD=100kb

# ログレベルの指定（debug / info / warn / error）
LOG_LEVEL=debug
