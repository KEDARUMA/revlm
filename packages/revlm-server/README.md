# @kedaruma/revlm-server

English documentation | [日本語ドキュメントはこちら](README-ja.md)

Self-hosted HTTP gateway that reproduces the MongoDB Realm App Services experience. It handles user authentication (password + provisional login) and proxied CRUD operations against MongoDB.

## Getting Started

```bash
pnpm install
pnpm run build
pnpm start   # runs dist/start.js
```

Set the following environment variables or values in a `.env` file before starting:

- `MONGO_URI` / `mongoUri`
- `USERS_DB_NAME` / `usersDbName`
- `USERS_COLLECTION_NAME` / `usersCollectionName`
- `JWT_SECRET` / `jwtSecret`
- `REFRESH_SECRET_SIGNING_KEY` / `refreshSecretSigningKey` (HMAC key for 5-minute refresh secret cookie rotation)
- Optional provisional auth settings (`provisionalLoginEnabled`, `provisionalAuthId`, etc.)
- Optional request body settings:
  - `BODY_LIMIT` limits accepted `application/ejson` and JSON request bodies. If omitted, it defaults to `1mb`.
  - `BODY_WARN_THRESHOLD` emits a warning log when the request body exceeds the threshold. If omitted, it defaults to `100kb`.

## Scripts

- `pnpm run build` – compile `src` to `dist`
- `pnpm test` – run the Jest suites (uses MongoMemoryServer)
- `pnpm run clean` – remove `dist` and local dependencies

## Publishing

Build the package and create a tarball before releasing:

```bash
pnpm run build
pnpm pack
```
