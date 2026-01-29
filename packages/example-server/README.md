# Example Server

This package provides a minimal `@kedaruma/revlm-server` sample for local development and testing. It loads configuration from `.env` (or a custom file via `EXAMPLE_SERVER_ENV`) and starts an in-memory MongoDB instance by default. It exposes the following scripts:

- `pnpm --filter @kedaruma/example-server start`: start the server using `tsx`.
- `pnpm --filter @kedaruma/example-server start-with-opts -- --port 4123`: pass additional CLI overrides (prefixed with `--`).
- `pnpm --filter @kedaruma/example-server stop`: shutdown the server (uses `.example-server.pid` by default).

Use this sample in client integration tests to ensure the refresh/token behavior matches the real server.
The `start` script writes `.example-server.pid` so the `stop` script can terminate it safely.

## .env.example
Copy `.env.example` to `.env` and adjust values before starting. The in-memory MongoDB will be created automatically:

```
USERS_DB_NAME=revlm
USERS_COLLECTION_NAME=users
JWT_SECRET=example-secret
REFRESH_SECRET_SIGNING_KEY=example-refresh-secret
PORT=4122
```

Additional options such as `REFRESH_WINDOW_SEC` or `PROVISIONAL_*` can also be provided.
