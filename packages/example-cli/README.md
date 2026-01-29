# Example CLI

A minimal CLI sample for `@kedaruma/revlm-client`.

- `pnpm --filter @kedaruma/example-cli start`: run the flow against an existing server.
- `pnpm --filter @kedaruma/example-cli test`: start the example-server (in-memory), run the flow, then stop it.

The flow is: register user → login → refresh → revlm-gate operation.

## .env.example
Copy `.env.example` to `.env` if you want to customize defaults for `start`.
