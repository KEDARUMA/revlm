# Example React Native

This package provides the React Native demo client for the Revlm server.

[日本語版はこちら](README-ja.md)

## Scripts

- `pnpm --filter @kedaruma/example-rn start`: start Metro.
- `pnpm --filter @kedaruma/example-rn ios`: run on iOS.
- `pnpm --filter @kedaruma/example-rn android`: run on Android.
- `pnpm --filter @kedaruma/example-rn trust:ios-cert`: trust mkcert root CA in booted iOS simulators.
- `pnpm --filter @kedaruma/example-rn trust:android-cert`: push and install cert on Android emulators.

## Environment files

### .env.autorefresh
If you want auto refresh behavior enabled, use the preset env file:

```
cp .env.autorefresh .env
```

This keeps the same settings as the default `.env`, with auto refresh enabled via:

```
AUTO_REFRESH_ON_401=true
```

## Start
Prerequisite: `pnpm demo` is running in `packages/example-server`.

```
pnpm install
pnpm --filter @kedaruma/example-rn start
```

In another terminal:

```
pnpm --filter @kedaruma/example-rn ios
```

Android:

```
pnpm --filter @kedaruma/example-rn android
```

## RN polyfills (important)
React Native does not provide Node/browser polyfills by default. This demo wires them explicitly in `index.js`
*before* importing the app. If you move or refactor this code, keep the order:

1) Buffer
2) crypto + getRandomValues
3) TextEncoder/TextDecoder
4) `@kedaruma/revlm-client/rn-setup`
5) App import

If the order is wrong, you will see errors like:
- `Property 'TextDecoder' doesn't exist`
- `BSON: For React Native please polyfill crypto.getRandomValues`

## Metro resolver setup (important)
pnpm uses symlinks, so Metro may not resolve nested dependencies.
This demo configures `metro.config.js` to:
- add workspace `node_modules` as a resolver path
- enable package `exports`
- map `crypto` and `@kedaruma/revlm-shared` explicitly
- shim `fast-base64-decode` to avoid CJS/ESM interop issues

## HTTPS setup for simulators (required)
The demo uses HTTPS (`https://localhost:4123`). You must trust the local certificate on each emulator/simulator.

Prerequisite: generate certs in example-server:
```
pnpm --filter @kedaruma/example-server setup-https
```

### iOS simulator
Boot the simulator, then run:
```
pnpm --filter @kedaruma/example-rn trust:ios-cert
```

This command is safe to run multiple times and targets all booted simulators.
It uses the mkcert root CA if available (recommended).

### Android emulator
Make sure an emulator is running, then run:
```
pnpm --filter @kedaruma/example-rn trust:android-cert
```

The emulator will show a certificate install UI. Approve the install when prompted.

## Runtime flow
1) Login page → authenticate with demo credentials.
2) Demo page → run revlm-gate operations and search.

## Environment variables

**Revlm server base URL**<br>
REVLM_BASE_URL=https://localhost:4123

**Users database name**<br>
USERS_DB_NAME=revlm

**Session ID for multi-session behavior**<br>
RN_REVLM_SESSION_ID=example-rn-session

**Enable provisional login**<br>
PROVISIONAL_LOGIN_ENABLED=true

**Provisional auth ID**<br>
PROVISIONAL_AUTH_ID=example-prov

**Provisional auth master secret**<br>
PROVISIONAL_AUTH_SECRET_MASTER=example-master

**Provisional auth domain**<br>
PROVISIONAL_AUTH_DOMAIN=example.domain

**Auto refresh on 401**<br>
AUTO_REFRESH_ON_401=true

**Client log level**<br>
LOG_LEVEL=debug
