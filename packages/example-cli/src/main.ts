import { runExampleFlow } from './run';

// Entrypoint for manual CLI usage.
// CLI用の実行エントリポイント。
//
// This script assumes an already-running server.
// If you want an end-to-end managed run (start server -> flow -> stop), use `pnpm test`.
//
// このスクリプトはサーバ起動済みを前提とする。
// サーバ起動→実行→停止まで自動で回す場合は `pnpm test` を使う。
async function run() {
  // Resolve runtime configuration (env override with defaults).
  // 実行時設定を環境変数から解決（無ければデフォルト）。
  const baseUrl = process.env.EXAMPLE_BASE_URL || 'http://localhost:4122';
  const usersDbName = process.env.USERS_DB_NAME || 'revlm';
  const provisionalAuthId = process.env.PROVISIONAL_AUTH_ID || 'example-prov';
  const provisionalAuthSecretMaster = process.env.PROVISIONAL_AUTH_SECRET_MASTER || 'example-master';
  const provisionalAuthDomain = process.env.PROVISIONAL_AUTH_DOMAIN || 'example.domain';
  const sessionId = process.env.EXAMPLE_SESSION_ID || 'example-cli-session';

  await runExampleFlow({
    baseUrl,
    usersDbName,
    provisionalAuthId,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
    sessionId,
  });
}

run().catch((error) => {
  console.error('Example CLI flow failed', error);
  process.exit(1);
});
