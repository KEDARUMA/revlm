import { runExampleFlow } from "./run.js";
import { printMoviesReport } from "./moviesReport.js";

// Entrypoint for demo CLI usage.
// CLIデモ用の実行エントリポイント。
//
// This script assumes the server is already running.
// It does NOT start the server by itself.
//
// このスクリプトはサーバ起動済みを前提とする。
// サーバ起動は行わない。
async function run() {
  // Resolve runtime configuration (env override with defaults).
  // 実行時設定を環境変数から解決（無ければデフォルト）。
  const baseUrl = process.env.EXAMPLE_BASE_URL || "http://localhost:4122";
  const usersDbName = process.env.USERS_DB_NAME || "revlm";
  const provisionalAuthId = process.env.PROVISIONAL_AUTH_ID || "example-prov";
  const provisionalAuthSecretMaster = process.env.PROVISIONAL_AUTH_SECRET_MASTER || "example-master";
  const provisionalAuthDomain = process.env.PROVISIONAL_AUTH_DOMAIN || "example.domain";
  const sessionId = process.env.EXAMPLE_SESSION_ID || "example-cli-session";

  await runExampleFlow({
    baseUrl,
    usersDbName,
    provisionalAuthId,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
    sessionId,
    // Use the demo account that example-server creates on startup.
    // example-server が起動時に作るデモアカウントを使う。
    demoUser: { authId: "demo", password: "demo-pass" },
    // Auto refresh for long report printing.
    // レポート出力が長くても落ちないよう自動リフレッシュを有効化。
    autoRefreshOn401: true,
    // Demo does not test refresh-token explicitly.
    // demo では refresh-token の明示テストは行わない。
    skipRefresh: true,

    // After login, run a read-only report against `movies_combined`.
    // login 後に `movies_combined` を読み取りレポート表示する。
    afterRefresh: async ({ revlm, usersDbName: dbName }) => {
      await printMoviesReport(revlm, dbName);
    },
  });
}

run().catch((error) => {
  console.error("Example CLI demo flow failed", error);
  process.exit(1);
});
