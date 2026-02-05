# Example CLI

[日本語版はこちら](README-ja.md)

A minimal CLI sample for `@kedaruma/revlm-client`.

- `pnpm --filter @kedaruma/example-cli demo`: run the flow against a running server.
- `pnpm --filter @kedaruma/example-cli test`: start example-server (in-memory DB), run the flow, then stop it.

Flow: user registration → login → refresh → revlm-gate operations.

## demo details
- Runs the CLI flow against an already running server.
- Target is configured via `REVLM_BASE_URL` in `.env`.
- Main steps: login (demo user) → revlm-gate operations → provisional login → registerUser → login (temp user) → deleteUser → movies_combined report.
- Reads the `movies_combined` collection and outputs a report (display/aggregation).

## test details
- Starts `example-server` temporarily and stops it after the flow finishes.
- Fails if `example-server` is already running; stop it first if needed.
  - Example: `pnpm --filter @kedaruma/example-server stop`

## .env settings
Key variables for `.env` (examples shown).

**Revlm server base URL (HTTP only)**<br>
REVLM_BASE_URL=http://localhost:4122

**Database name**<br>
USERS_DB_NAME=revlm

**Session ID (should be unique)**<br>
REVLM_SESSION_ID=example-cli-session

**Enable provisional login**<br>
PROVISIONAL_LOGIN_ENABLED=true

**Provisional auth ID**<br>
PROVISIONAL_AUTH_ID=example-prov

**Provisional auth master secret**<br>
PROVISIONAL_AUTH_SECRET_MASTER=example-master

**Provisional auth domain**<br>
PROVISIONAL_AUTH_DOMAIN=example.domain

**Auto refresh on token expiry**<br>
AUTO_REFRESH_ON_401=false

**Log level**<br>
LOG_LEVEL=debug
