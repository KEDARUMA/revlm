# Example Server

[Japanese version](README-ja.md)

This package provides a minimal sample for local development and testing. It loads configuration from `.env` (or the file specified by `EXAMPLE_SERVER_ENV`) and starts an in-memory MongoDB instance.

## Scripts

- `pnpm --filter @kedaruma/example-server start`: start the server.
- `pnpm --filter @kedaruma/example-server start-with-opts -- --port 4123`: start with CLI overrides (for demo/test).
- `pnpm --filter @kedaruma/example-server stop`: stop the server (uses `.example-server.pid`).
- `pnpm --filter @kedaruma/example-server setup-https`: generate local certificates with mkcert.
- `pnpm --filter @kedaruma/example-server reset-data`: delete and recreate sample data.

`start / demo` writes `.example-server.pid`, so `stop` can shut it down safely (Ctrl+C also stops it).

## HTTPS proxy (for local browser use)
When the client is a browser, HTTPS is required. example-server starts a local HTTPS proxy and forwards requests to the HTTP backend.
The backend stays unchanged; TLS is terminated at the proxy.
This setup is intended for debugging only. For production, terminate TLS with a proper HTTP server such as Nginx or Apache.

### 1) Prepare certificates (mkcert)
Use mkcert to trust a local certificate.

Example (run from repo root):
```
pnpm --filter @kedaruma/example-server setup-https
```

Manual steps:
```
mkdir -p packages/example-server/.certs
mkcert -install
mkcert -key-file packages/example-server/.certs/localhost-key.pem \
  -cert-file packages/example-server/.certs/localhost.pem \
  localhost 127.0.0.1 ::1
```

Files created:
- `packages/example-server/.certs/localhost-key.pem`
- `packages/example-server/.certs/localhost.pem`

### 1.5) React Native (simulators)
The React Native demo uses HTTPS, so you must trust the cert on each simulator/emulator.
Run the helper scripts from `packages/example-rn` after booting the device:

```
pnpm --filter @kedaruma/example-rn trust:ios-cert
pnpm --filter @kedaruma/example-rn trust:android-cert
```

The iOS script installs the mkcert root CA on all booted simulators.
Run it again whenever you boot a different device.

### 2) Configure proxy via .env.proxy
The proxy uses these environment variables (all optional):
- `EXAMPLE_PROXY_HTTPS_PORT` (HTTPS listen port)
- `EXAMPLE_PROXY_TARGET_PORT` (HTTP target port)
- `EXAMPLE_PROXY_KEY_FILE` (default: `packages/example-server/.certs/localhost-key.pem`)
- `EXAMPLE_PROXY_CERT_FILE` (default: `packages/example-server/.certs/localhost.pem`)
- `EXAMPLE_PROXY_CA_FILE` (optional)

Example:
```
EXAMPLE_PROXY_ENV=.env.proxy
EXAMPLE_PROXY_HTTPS_PORT=44123
EXAMPLE_PROXY_TARGET_PORT=4122
```

Override the proxy env file path with `EXAMPLE_PROXY_ENV`.

### 3) Start (proxy is automatic)
```
pnpm --filter @kedaruma/example-server start
```

This starts:
- HTTP backend (revlm-server)
- HTTPS proxy (terminates TLS and forwards to HTTP)

### 4) Access
Access via HTTPS:
```
https://127.0.0.1:<EXAMPLE_PROXY_HTTPS_PORT>
```

If you need a hostname other than `127.0.0.1`, add it when generating certs with mkcert.

## Environment variables (based on .env.start)

# Atlas example
# MONGO_URI=mongodb+srv://<USER_ID>:<PASSWORD>@???.mongodb.net/?appName=???

# Local MongoDB example
# MONGO_URI=mongodb://localhost:27017
MONGO_URI=<MUST BE SPECIFIED>

# Database name
USERS_DB_NAME=revlm

# User collection name (stores user information)
USERS_COLLECTION_NAME=users

# Secret used to sign access tokens
JWT_SECRET=example-secret

# Secret used to sign refresh tokens
REFRESH_SECRET_SIGNING_KEY=example-refresh-secret

# Server port (HTTP)
PORT=4122

# Allowed app origins for CORS (comma-separated)
#CORS_ORIGIN=https://xxx.yyy.zzz

# Disable Secure cookie for HTTP demo usage (set to true/omit for HTTPS)
COOKIE_SECURE=true

# SameSite setting (none|lax|strict). Use "none" for cross-site browser demos.
COOKIE_SAMESITE=none

# Provisional Login allows initial account/user creation with provisional credentials.

# Enable or disable Provisional Login
PROVISIONAL_LOGIN_ENABLED=true

# Provisional auth ID
PROVISIONAL_AUTH_ID=example-prov

# Provisional auth master secret
PROVISIONAL_AUTH_SECRET_MASTER=example-master

# Provisional auth domain
PROVISIONAL_AUTH_DOMAIN=example.domain

# Access token expiration time (seconds)
JWT_EXPIRES_IN=600

# Additional grace period after refresh token expiration (seconds)
# 0 means unlimited
REFRESH_WINDOW_SEC=300

# Refresh secret lifetime (seconds)
# 0 means unlimited
REFRESH_SECRET_TTL_SEC=300

# Request body limit
BODY_LIMIT=1mb

# Stored session lifetime (seconds)
# 0 means unlimited
REFRESH_SESSION_TTL_SEC=2592000

# Warn when request body exceeds this threshold
BODY_WARN_THRESHOLD=100kb

# Log level (debug / info / warn / error)
LOG_LEVEL=debug
