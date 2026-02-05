# Example Vue

This package provides the Vue demo client for the Revlm server.

[日本語版はこちら](README-ja.md)

## Scripts

- `pnpm --filter @kedaruma/example-vue demo`: start the Vite dev server.
- `pnpm --filter @kedaruma/example-vue test`: run Vitest.

## Environment files

### .env.autorefresh
If you want auto refresh behavior enabled, use the preset env file:

```
cp .env.autorefresh .env
```

This keeps the same settings as the default `.env`, with auto refresh enabled via:
```
VITE_AUTO_REFRESH_ON_401=true
```

## Start
Prerequisite: `pnpm demo` is running in `packages/example-server`.

```
pnpm --filter @kedaruma/example-vue demo
```

## Runtime flow
1) Login page → authenticate with demo credentials.
2) Demo page → run revlm-gate operations and search.

## Environment variables

**Revlm server base URL**<br>
VITE_REVLM_BASE_URL=https://localhost:4123

**Users database name**<br>
VITE_USERS_DB_NAME=revlm

**Session ID for multi-session behavior**<br>
VITE_VUE_REVLM_SESSION_ID=example-vue-session

**Enable provisional login**<br>
VITE_PROVISIONAL_LOGIN_ENABLED=true

**Provisional auth ID**<br>
VITE_PROVISIONAL_AUTH_ID=example-prov

**Provisional auth master secret**<br>
VITE_PROVISIONAL_AUTH_SECRET_MASTER=example-master

**Provisional auth domain**<br>
VITE_PROVISIONAL_AUTH_DOMAIN=example.domain

**Auto refresh on 401**<br>
VITE_AUTO_REFRESH_ON_401=true

**Client log level**<br>
VITE_LOG_LEVEL=debug
