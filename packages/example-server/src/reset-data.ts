import fs from "fs/promises";
import path from "path";

// Reset persistent MongoDB data used by example-server.
// example-server が使う永続MongoDBデータを完全初期化する。
//
// What it does:
// - Deletes `packages/example-server/.data/mongodb` (or a custom path via env).
// - This forces the next `pnpm start` to rebuild the DB from scratch (including movies_combined).
//
// 動作:
// - `packages/example-server/.data/mongodb`（または env 指定）を丸ごと削除。
// - 次回 `pnpm start` でDBが完全に作り直され（movies_combined も再投入される）。

function resolveDbPath(): string {
  // Keep the path local to this package by default.
  // 既定ではこのパッケージ配下に閉じたパスにする。
  //
  // This is the same location used by `src/demo-test-start.ts` for MongoMemoryServer dbPath.
  // `src/demo-test-start.ts` が MongoMemoryServer の dbPath として使う場所と同じ。
  const configured = process.env.EXAMPLE_SERVER_DB_PATH;
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), ".data", "mongodb");
}

async function run() {
  const dbPath = resolveDbPath();
  // eslint-disable-next-line no-console
  console.log("[example-server] reset-data", { dbPath });
  await fs.rm(dbPath, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log("[example-server] reset-data done");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[example-server] reset-data failed", err);
  process.exit(1);
});
