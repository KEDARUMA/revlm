# Example CLI

[English version](README.md)

`@kedaruma/revlm-client` の最小 CLI サンプルです。

- `pnpm --filter @kedaruma/example-cli demo`: 起動済みサーバに対してフローを実行します。
- `pnpm --filter @kedaruma/example-cli test`: example-server を起動（インメモリDB）、フロー実行後に停止します。

実行フロー: ユーザ登録 → ログイン → リフレッシュ → revlm-gate 操作。

## demo の説明
- 起動済みのサーバに対して CLI フローを実行します。
- `.env` の `REVLM_BASE_URL` で接続先を指定します。
- 主な処理: login（demo user）→ revlm-gate 操作 → provisional login → registerUser → login（temp user）→ deleteUser → movies_combined レポート。
- `movies_combined` コレクションを参照し、映画データのレポート（表示/集計）を出力します。

## test の説明
- `example-server` を一時的に起動し、フロー実行後に停止します。
- 既に `example-server` が起動中だと失敗するので、必要なら先に停止してください。
  - 例: `pnpm --filter @kedaruma/example-server stop`

## .env の説明
`.env` に設定する主要な変数です（例を記載）。

**Revlmサーバの接続先（HTTPのみ）**<br>
REVLM_BASE_URL=http://localhost:4122

**使用データベース名**<br>
USERS_DB_NAME=revlm

**セッションID（ユニーク推奨）**<br>
REVLM_SESSION_ID=example-cli-session

**provisional login の有効化**<br>
PROVISIONAL_LOGIN_ENABLED=true

**provisional login の認証ID**<br>
PROVISIONAL_AUTH_ID=example-prov

**provisional login のマスターシークレット**<br>
PROVISIONAL_AUTH_SECRET_MASTER=example-master

**provisional login のドメイン**<br>
PROVISIONAL_AUTH_DOMAIN=example.domain

**トークン失効時の自動リフレッシュ**<br>
AUTO_REFRESH_ON_401=false

**ログレベル**<br>
LOG_LEVEL=debug
