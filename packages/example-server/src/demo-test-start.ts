import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { config as loadEnv } from "dotenv";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Collection } from "mongodb";
import { parse as parseCsv } from "csv-parse/sync";
import { createRequire } from "module";
import { AuthClient } from "@kedaruma/revlm-shared/auth-token";

// CLI option map (string to string).
// CLIオプションを文字列で保持するマップ。
type Args = Record<string, string>;

// Environment config snapshot for example-server.
// example-server用の環境変数スナップショット。
type EnvConfig = {
  usersDbName?: string;
  usersCollectionName?: string;
  jwtSecret?: string;
  refreshSecretSigningKey?: string;
  provisionalLoginEnabled?: string;
  provisionalAuthId?: string;
  provisionalAuthSecretMaster?: string;
  provisionalAuthDomain?: string;
  jwtExpiresIn?: string;
  refreshWindowSec?: string;
  refreshSecretTtlSec?: string;
  refreshSessionTtlSec?: string;
  port?: string;
};

// Dataset source (CSV) for example-server seeding.
// example-server のシード用データセット（CSV）取得先。
const MOVIES_CSV_URL = "https://raw.githubusercontent.com/Simatwa/movies-dataset/main/data/combined.csv";

// We persist this collection across restarts.
// 再起動を跨いで永続化したいコレクション。
const MOVIES_COLLECTION = "movies_combined";

// Text index name for simple full-text search.
// 文字列検索（全文検索）用の Text Index 名。
const MOVIES_TEXT_INDEX_NAME = "movies_text_all";

// Demo user (always created on server boot for the CLI walkthrough).
// CLIデモ用の固定ユーザ（サーバ起動時に毎回作成する）。
//
// NOTE:
// - This is for demos only. Do NOT use these credentials for any real environment.
// - The example-server is for local development/testing only and uses an in-memory/persistent sandbox DB.
//
// 注:
// - これはデモ専用。実環境でこの認証情報を使ってはいけない。
// - example-server はローカル開発/テスト向けで、サンドボックスDB（MongoMemoryServer）前提。
const DEMO_AUTH_ID = "demo";
const DEMO_PASSWORD = "demo-pass";

// Parse `--key value` style CLI arguments.
// `--key value` 形式のCLI引数を解析する。
function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

// Resolve PID file path for start/stop coordination.
// start/stop連携用のPIDファイルパスを解決する。
function getPidFilePath(): string {
  const configured = process.env.EXAMPLE_SERVER_PID_FILE;
  return configured ? path.resolve(process.cwd(), configured) : path.resolve(process.cwd(), ".example-server.pid");
}

// Resolve persistent MongoDB dbPath for MongoMemoryServer.
// MongoMemoryServer の永続化用 dbPath を解決する。
function getDbPath(): string {
  // Keep it local to this package by default.
  // 既定ではこのパッケージ配下に閉じたパスにする。
  //
  // Why not use OS temp dir?
  // - We want the dataset to persist across restarts.
  // - We also want users to be able to inspect/delete the data easily.
  //
  // なぜOSの一時ディレクトリにしないのか？
  // - 再起動を跨いでデータを残したい。
  // - どこにデータがあるか分かりやすく、ユーザが手で消せる方が良い。
  const configured = process.env.EXAMPLE_SERVER_DB_PATH;
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), ".data", "mongodb");
}

// Resolve cache file path for the movies CSV.
// movies CSV のキャッシュファイルパスを解決する。
function getMoviesCachePath(): string {
  // User requested "symbol-prefixed" filename to make it look like a temporary cache.
  // ユーザ要望: 先頭に記号を付けて「一時キャッシュ」感を出す。
  //
  // Important:
  // - This cache is *not* the MongoDB data.
  // - It only avoids re-downloading the CSV from GitHub repeatedly.
  //
  // 重要:
  // - これはMongoDBデータではない。
  // - GitHub から毎回CSVを再DLしないための“ファイルキャッシュ”のみ。
  return path.resolve(process.cwd(), ".cache", "$$movies-data.csv");
}

// Ensure stale PID files are cleared before start.
// 起動前に古いPIDファイルを掃除する。
function clearStalePidFile(pidFile: string) {
  if (!fs.existsSync(pidFile)) return;
  const raw = fs.readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  if (Number.isNaN(pid)) {
    fs.unlinkSync(pidFile);
    return;
  }
  try {
    process.kill(pid, 0);
    throw new Error(`Server already running with PID ${pid}`);
  } catch (error: any) {
    if (error && error.code === 'ESRCH') {
      fs.unlinkSync(pidFile);
      return;
    }
    throw error;
  }
}

// Convert env/CLI values into numbers when possible.
// 環境変数/CLI値を数値に変換する。
function asNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Convert env/CLI values into booleans when possible.
// 環境変数/CLI値を真偽値に変換する。
function asBoolean(value?: string): boolean | undefined {
  if (!value) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

// Snapshot environment variables for configuration.
// 環境変数を設定用に読み取る。
function readEnv(): EnvConfig {
  // With `exactOptionalPropertyTypes`, optional properties must be omitted (not set to `undefined`).
  // `exactOptionalPropertyTypes` 有効時は、optionalなプロパティに `undefined` を入れず「未定義なら省略」する。
  const env: EnvConfig = {};
  if (process.env.USERS_DB_NAME) env.usersDbName = process.env.USERS_DB_NAME;
  if (process.env.USERS_COLLECTION_NAME) env.usersCollectionName = process.env.USERS_COLLECTION_NAME;
  if (process.env.JWT_SECRET) env.jwtSecret = process.env.JWT_SECRET;
  if (process.env.REFRESH_SECRET_SIGNING_KEY) env.refreshSecretSigningKey = process.env.REFRESH_SECRET_SIGNING_KEY;
  if (process.env.PROVISIONAL_LOGIN_ENABLED) env.provisionalLoginEnabled = process.env.PROVISIONAL_LOGIN_ENABLED;
  if (process.env.PROVISIONAL_AUTH_ID) env.provisionalAuthId = process.env.PROVISIONAL_AUTH_ID;
  if (process.env.PROVISIONAL_AUTH_SECRET_MASTER) env.provisionalAuthSecretMaster = process.env.PROVISIONAL_AUTH_SECRET_MASTER;
  if (process.env.PROVISIONAL_AUTH_DOMAIN) env.provisionalAuthDomain = process.env.PROVISIONAL_AUTH_DOMAIN;
  if (process.env.JWT_EXPIRES_IN) env.jwtExpiresIn = process.env.JWT_EXPIRES_IN;
  if (process.env.REFRESH_WINDOW_SEC) env.refreshWindowSec = process.env.REFRESH_WINDOW_SEC;
  if (process.env.REFRESH_SECRET_TTL_SEC) env.refreshSecretTtlSec = process.env.REFRESH_SECRET_TTL_SEC;
  if (process.env.REFRESH_SESSION_TTL_SEC) env.refreshSessionTtlSec = process.env.REFRESH_SESSION_TTL_SEC;
  if (process.env.PORT) env.port = process.env.PORT;
  return env;
}

async function ensureFileCached(url: string, filePath: string): Promise<void> {
  // Download once, reuse later.
  // 初回だけDLして以後はキャッシュを使う。
  //
  // NOTE:
  // - This is intentionally simple: if the file exists and is non-empty, we trust it.
  // - If you want freshness, delete the cache file manually.
  //
  // 注:
  // - ここは意図的に簡単にしている（ファイルが存在しサイズ>0なら正しいとみなす）。
  // - 最新化したい場合はキャッシュファイルを削除してください。
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > 0) return;
  } catch (_e) {
    // missing -> download
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // eslint-disable-next-line no-console
  console.log("[example-server] downloading csv...", { url, filePath });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download csv: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(filePath, buf);
  // eslint-disable-next-line no-console
  console.log("[example-server] csv cached", { bytes: buf.byteLength });
}

function parseCsvFile(csvText: string): Record<string, any>[] {
  // Use a real CSV parser because the dataset contains commas/quotes in fields.
  // 文字列中のカンマ/クォートを考慮するため、ちゃんとしたCSVパーサを使う。
  //
  // We parse into objects with `columns: true` so each row becomes:
  //   { genre: "...", title: "...", ... }
  //
  // `columns: true` により、各行を
  //   { genre: "...", title: "...", ... }
  // のようなオブジェクトに変換する。
  return parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as any[];
}

function normalizeMoviesRow(row: Record<string, any>): Record<string, any> {
  // The upstream CSV uses an empty header name for the first column.
  // That becomes a JS object key of `""`, which is awkward for both:
  // - TypeScript typing
  // - MongoDB index definitions (text index cannot target an empty field name)
  //
  // For our examples we rename it to `_raw0`.
  //
  // 元CSVは先頭カラム名が空文字です。
  // そのままだとオブジェクトのキーが `""` になり扱いづらく、さらに:
  // - TypeScriptの型定義
  // - MongoDBのインデックス（空のフィールド名には張れない）
  // の両面で困るので、`_raw0` にリネームします。
  //
  // Why keep it at all?
  // - For demos we want to preserve the original dataset as much as possible.
  // - Users can later decide to drop/ignore this field in their own code.
  //
  // なぜ保持するのか？
  // - デモとしては元データをできるだけ維持したい。
  // - 実際の利用で不要なら、利用側で無視/削除すればよい。
  if (Object.prototype.hasOwnProperty.call(row, "")) {
    row._raw0 = row[""];
    delete row[""];
  }
  return row;
}

async function ensureMoviesTextIndex(moviesCol: Collection<Record<string, any>>) {
  // Make the index idempotent:
  // - If it exists, do nothing.
  // - If it doesn't, create it.
  //
  // インデックスは冪等にする:
  // - 既に存在すれば何もしない
  // - 無ければ作成
  //
  // Why not always recreate?
  // - Building a text index can take time.
  // - We want example-server start to be repeatable and reasonably fast after the first run.
  //
  // なぜ毎回作り直さないのか？
  // - text index の構築は時間がかかり得る。
  // - 初回だけ重くし、2回目以降は速く起動できるようにしたい。
  const existing = await moviesCol.indexes();
  if (existing.some((i: any) => i && i.name === MOVIES_TEXT_INDEX_NAME)) return;

  // eslint-disable-next-line no-console
  console.log("[example-server] creating text index...", { collection: MOVIES_COLLECTION, name: MOVIES_TEXT_INDEX_NAME });

  // Text index requires enumerating fields (no wildcard "all fields").
  // `movies_combined` is a demo dataset, so we simply index all known columns (except _id).
  //
  // Text index は対象フィールドを列挙する必要がある（全フィールドのワイルドカードは不可）。
  // `movies_combined` はデモ用データセットなので、既知の全カラム（_id以外）を対象にする。
  //
  // Searching notes (MongoDB Text Index):
  // - Find:   col.find({ $text: { $search: "batman" } })
  // - Agg:    col.aggregate([{ $match: { $text: { $search: "batman" } } }, ...])
  // - Regex:  not index-backed by this text index (use with care).
  //
  // 検索メモ（MongoDB Text Index）:
  // - Find:   col.find({ $text: { $search: "batman" } })
  // - Agg:    col.aggregate([{ $match: { $text: { $search: "batman" } } }, ...])
  // - Regex:  text index は使われないことが多い（注意）。
  await moviesCol.createIndex(
    {
      _raw0: "text",
      genre: "text",
      category: "text",
      title: "text",
      year: "text",
      distribution: "text",
      description: "text",
      url: "text",
      cover_photo: "text",
    },
    { name: MOVIES_TEXT_INDEX_NAME }
  );
  // eslint-disable-next-line no-console
  console.log("[example-server] text index created", { name: MOVIES_TEXT_INDEX_NAME });
}

async function seedMoviesIfNeeded(mongoUri: string, dbName: string) {
  // Seeding policy:
  // - Persist `movies_combined` only.
  // - Drop all other collections on every start to keep tests/demos reproducible.
  // - If `movies_combined` already has data, skip the costly CSV import.
  //
  // シード方針:
  // - `movies_combined` だけ永続化する。
  // - それ以外のコレクションは毎回 drop してテスト/デモを再現性ある状態に保つ。
  // - `movies_combined` に既にデータがあれば重いCSV投入はスキップする。
  //
  // Why "drop others"?
  // - revlm-server creates operational collections (e.g. users, refresh sessions).
  // - If we keep those across restarts, demo/test runs can interfere with each other.
  //
  // なぜ「movies以外を毎回drop」するのか？
  // - revlm-server は運用系コレクション（users, refresh sessions等）を作る。
  // - それらが残ると、デモ/テストの再実行が互いに干渉しやすい。
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(dbName);

    // Drop non-persistent collections.
    // 永続化しないコレクションはすべて削除。
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const c of cols) {
      if (!c?.name) continue;
      if (c.name === MOVIES_COLLECTION) continue;
      try {
        // eslint-disable-next-line no-console
        console.log("[example-server] dropping collection", { dbName, collection: c.name });
        await db.collection(c.name).drop();
      } catch (_e) {
        // ignore: may already be gone or not droppable
      }
    }

    const moviesCol = db.collection(MOVIES_COLLECTION);
    const count = await moviesCol.countDocuments({}, { limit: 1 });
    if (count > 0) {
      // If the collection already exists, ensure the text index exists too.
      // 既にデータがある場合でも、Text Index は必要なら作る。
      //
      // IMPORTANT:
      // If older runs inserted documents with an empty field name `""` (pre-normalization),
      // we cannot reliably build a text index. In that case, reset-data is required.
      //
      // 重要:
      // 以前の実装で空のフィールド名 `""` のまま投入されている場合、
      // text index を張れない/扱いづらいので reset-data が必要。
      //
      // This is why we keep `reset-data`:
      // - It clears the persisted dbPath.
      // - Next start will rebuild documents with `_raw0` and then create the text index.
      //
      // `reset-data` を用意している理由:
      // - 永続dbPathを丸ごと消して初期化できる。
      // - 次回起動で `_raw0` 正規化済みで再投入し、text indexも作れる。
      const sample = await moviesCol.findOne({});
      if (sample && Object.prototype.hasOwnProperty.call(sample as any, "")) {
        // eslint-disable-next-line no-console
        console.warn(
          "[example-server] movies_combined contains legacy empty-key documents; run `pnpm --filter @kedaruma/example-server reset-data` to rebuild with `_raw0` and enable text index"
        );
        return;
      }
      await ensureMoviesTextIndex(moviesCol);
      // eslint-disable-next-line no-console
      console.log("[example-server] movies already seeded; skipping import", { dbName, collection: MOVIES_COLLECTION });
      return;
    }

    const cachePath = getMoviesCachePath();
    await ensureFileCached(MOVIES_CSV_URL, cachePath);
    const csvText = await fsp.readFile(cachePath, "utf8");
    const rows = parseCsvFile(csvText).map(normalizeMoviesRow);
    // Deduplicate by (year + title) and keep the first occurrence.
    // year + title で重複排除し、最初に出てきた1件だけ残す。
    const seen = new Set<string>();
    const deduped: Record<string, any>[] = [];
    for (const row of rows) {
      const year = String(row.year ?? "").trim();
      const title = String(row.title ?? "").trim();
      const key = `${year}::${title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    // eslint-disable-next-line no-console
    console.log("[example-server] movies dedupe", { total: rows.length, deduped: deduped.length });

    // Insert in chunks to avoid huge payloads / memory spikes.
    // 1回のinsertManyが巨大にならないよう、チャンクで投入する。
    const chunkSize = 1000;
    let inserted = 0;
    for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      await moviesCol.insertMany(chunk as any[]);
      inserted += chunk.length;
      if (inserted % 5000 === 0) {
        // eslint-disable-next-line no-console
        console.log("[example-server] movies import progress", { inserted });
      }
    }
    // eslint-disable-next-line no-console
    console.log("[example-server] movies seeded", { dbName, collection: MOVIES_COLLECTION, inserted });

    // Ensure the text index exists after importing.
    // 取り込み後に文字列検索用のText Indexを作成する。
    await ensureMoviesTextIndex(moviesCol);
  } finally {
    await client.close(true);
  }
}

async function createDemoUserIfPossible(serverUrl: string, env: EnvConfig, cli: Args) {
  // Demo user creation policy:
  // - Always attempt to create the same demo user on each start.
  // - If the user already exists, treat it as a broken premise and fail fast.
  // - Create it via provisional-login -> registerUser (API path) as requested.
  //
  // デモユーザ作成方針:
  // - 起動のたびに同じ demo ユーザを必ず作ろうとする。
  // - 既に存在する場合は前提崩れとして即失敗させる。
  // - provisional-login -> registerUser（API経由）で作成する（要望通り）。
  //
  // Why "fail if exists"?
  // - This example server assumes a clean environment per run.
  // - If demo already exists, it usually means "reset-data" wasn't applied or DBPath got reused unexpectedly.
  //
  // なぜ「既に存在したら失敗」なのか？
  // - example-server は「実行ごとにクリーン」前提で運用したい。
  // - demoが残るのは、reset-data未実施 or 想定外にDBが再利用されたサインになりがち。

  const provisionalEnabled = asBoolean(cli.provisionalLoginEnabled ?? env.provisionalLoginEnabled);
  const provisionalAuthId = cli.provisionalAuthId || env.provisionalAuthId;
  const provisionalAuthSecretMaster = cli.provisionalAuthSecretMaster || env.provisionalAuthSecretMaster;
  const provisionalAuthDomain = cli.provisionalAuthDomain || env.provisionalAuthDomain;
  const jwtSecret = cli.jwtSecret || env.jwtSecret;

  // This demo always creates the user on boot.
  // If provisional-login isn't configured, we fail fast so the operator notices immediately.
  //
  // このデモは起動時に必ずdemoユーザを作る。
  // provisional-login が未設定なら、前提が崩れているので即失敗させて気づけるようにする。
  if (!provisionalEnabled || !provisionalAuthId || !provisionalAuthSecretMaster || !provisionalAuthDomain || !jwtSecret) {
    throw new Error(
      "[example-server] demo user creation requires PROVISIONAL_LOGIN_ENABLED=true and PROVISIONAL_AUTH_* plus JWT_SECRET"
    );
  }

  try {
    // Produce a valid provisional password.
    // provisional 用パスワードを生成する。
    const provisionalClient = new AuthClient({
      secretMaster: provisionalAuthSecretMaster,
      authDomain: provisionalAuthDomain,
    });
    const provisionalPassword = await provisionalClient.producePassword(provisionalAuthId);

    // 1) provisional-login to obtain a short-lived JWT.
    // 1) provisional-login で短命JWTを取得。
    const provRes = await fetch(`${serverUrl}/provisional-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authId: provisionalAuthId, password: provisionalPassword }),
    });
    const provBody: any = await provRes.json().catch(() => null);
    if (!provRes.ok || !provBody?.ok || !provBody?.token) {
      throw new Error(`provisional-login failed: ${provRes.status} ${JSON.stringify(provBody)}`);
    }
    const provisionalToken = String(provBody.token);

    // 2) registerUser using the provisional JWT (verifyToken only).
    // 2) provisional JWT（verifyTokenのみ）で registerUser を実行する。
    const regRes = await fetch(`${serverUrl}/registerUser`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Revlm-JWT": `Bearer ${provisionalToken}`,
      },
      body: JSON.stringify({
        user: { authId: DEMO_AUTH_ID, userType: "staff", roles: ["example"], name: "Demo User" },
        password: DEMO_PASSWORD,
      }),
    });
    const regBody: any = await regRes.json().catch(() => null);
    if (!regRes.ok || !regBody?.ok) {
      // If demo already exists, fail fast: the environment should be clean/reset.
      // demoが既に存在する場合は即失敗: 環境はクリーン/reset済みの前提。
      throw new Error(`registerUser failed: ${regRes.status} ${JSON.stringify(regBody)}`);
    }
    // eslint-disable-next-line no-console
    console.log("[example-server] demo user created", { authId: DEMO_AUTH_ID });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[example-server] demo user creation failed", e?.message || e);
    throw e;
  }
}

async function waitForHttpServer(serverUrl: string, timeoutMs: number): Promise<void> {
  // Wait until the HTTP server is actually listening.
  // HTTPサーバが実際にlistenするまで待つ。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${serverUrl}/__example_server_ready__`, { method: "GET" });
      // Any HTTP response means the server is reachable (404 is fine).
      // どんなHTTPレスポンスでもOK（404でもlisten済みと判定）。
      void res;
      return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`[example-server] server did not become ready in time: ${serverUrl}`);
}

function resolveRevlmServerStartJs(): string {
  // We intentionally run the "standard" revlm-server entrypoint:
  //   node node_modules/@kedaruma/revlm-server/dist/start.js
  //
  // This produces the official init log (🚀 Revlm Server Init {...}) and keeps behavior consistent
  // with real-world usage (npm installed package).
  //
  // 意図的に revlm-server の「標準起動」を実行する:
  //   node node_modules/@kedaruma/revlm-server/dist/start.js
  //
  // これにより公式の起動ログ（🚀 Revlm Server Init {...}）が出て、
  // 実運用（npm installして起動）に近い挙動になる。
  const require = createRequire(import.meta.url);
  return require.resolve("@kedaruma/revlm-server/dist/start.js");
}

// Start in-memory MongoDB + revlm-server, then wait for signals.
// オンメモリMongoDB + revlm-server を起動しシグナル待機する。
async function run() {
  const pidFile = getPidFilePath();
  const dbPath = getDbPath();
  // Load .env (or custom env file).
  // .env（または指定ファイル）を読み込む。
  const envFile = process.env.EXAMPLE_SERVER_ENV
    ? path.resolve(process.cwd(), process.env.EXAMPLE_SERVER_ENV)
    : path.resolve(process.cwd(), ".env");
  loadEnv({ path: envFile, override: true });
  const cli = parseArgs(process.argv.slice(2));
  const env = readEnv();
  // MongoMemoryServer instance for the sample backend.
  // サンプル用MongoMemoryServerインスタンス。
  let mongod: MongoMemoryServer | undefined;
  let child: ChildProcess | undefined;
  let shuttingDown = false;

  try {
    // Guard against stale PID files before boot.
    // 起動前に古いPIDファイルを整理する。
    clearStalePidFile(pidFile);
    // Ensure persistent dbPath exists.
    // 永続化用の dbPath を作成する。
    fs.mkdirSync(dbPath, { recursive: true });

    // Start MongoMemoryServer with persistence.
    // MongoMemoryServer を永続化モードで起動する。
    //
    // Note:
    // - MongoMemoryServer is typically "in-memory", but it can also persist to disk via `dbPath`.
    // - We use this to keep `movies_combined` across restarts while still being easy to reset.
    //
    // 注意:
    // - MongoMemoryServer は通常「メモリDB」だが、`dbPath` 指定でディスク永続化が可能。
    // - これにより `movies_combined` を再起動を跨いで保持しつつ、reset-dataで簡単に初期化できる。
    mongod = await MongoMemoryServer.create({
      instance: {
        dbName: cli.usersDbName || env.usersDbName || "revlm",
        dbPath,
      },
    });
    const mongoUri = mongod.getUri();

    // Seed movies and cleanup other collections before starting revlm-server.
    // revlm-server 起動前に movies を投入し、それ以外のコレクションを整理する。
    await seedMoviesIfNeeded(mongoUri, cli.usersDbName || env.usersDbName || "revlm");

    // Compose server configuration (CLI overrides env values).
    // CLIで指定された値を環境変数より優先して設定する。
    const serverConfig = {
      mongoUri,
      usersDbName: cli.usersDbName || env.usersDbName,
      usersCollectionName: cli.usersCollectionName || env.usersCollectionName,
      jwtSecret: cli.jwtSecret || env.jwtSecret,
      refreshSecretSigningKey: cli.refreshSecretSigningKey || env.refreshSecretSigningKey,
      provisionalLoginEnabled: asBoolean(cli.provisionalLoginEnabled ?? env.provisionalLoginEnabled),
      provisionalAuthId: cli.provisionalAuthId || env.provisionalAuthId,
      provisionalAuthSecretMaster: cli.provisionalAuthSecretMaster || env.provisionalAuthSecretMaster,
      provisionalAuthDomain: cli.provisionalAuthDomain || env.provisionalAuthDomain,
      jwtExpiresIn: asNumber(cli.jwtExpiresIn || env.jwtExpiresIn),
      refreshWindowSec: asNumber(cli.refreshWindowSec || env.refreshWindowSec),
      refreshSecretTtlSec: asNumber(cli.refreshSecretTtlSec || env.refreshSecretTtlSec),
      refreshSessionTtlSec: asNumber(cli.refreshSessionTtlSec || env.refreshSessionTtlSec),
      port: Number(cli.port || env.port || 4122),
    } as const;

    // Start revlm-server via the standard entrypoint (dist/start.js).
    // revlm-server を標準起動（dist/start.js）で立ち上げる。
    //
    // Why not call `startServer()` directly?
    // - We want the same logs and behavior as "node dist/start.js".
    // - This makes example-server a closer approximation of how users will run the server from npm.
    //
    // なぜ `startServer()` を直接呼ばないのか？
    // - 「node dist/start.js」と同じログ/挙動に揃えたい。
    // - example-server を「npmからインストールして起動する」実態に寄せたい。
    const startJsPath = resolveRevlmServerStartJs();
    const serverUrl = `http://127.0.0.1:${serverConfig.port}`;

    // We pass config via environment variables because dist/start.js reads .env + process.env.
    // dist/start.js は .env + process.env を読むので、設定は env 経由で渡す。
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MONGO_URI: mongoUri,
      USERS_DB_NAME: serverConfig.usersDbName,
      USERS_COLLECTION_NAME: serverConfig.usersCollectionName,
      JWT_SECRET: serverConfig.jwtSecret,
      REFRESH_SECRET_SIGNING_KEY: serverConfig.refreshSecretSigningKey,
      PROVISIONAL_LOGIN_ENABLED: String(!!serverConfig.provisionalLoginEnabled),
      PROVISIONAL_AUTH_ID: serverConfig.provisionalAuthId,
      PROVISIONAL_AUTH_SECRET_MASTER: serverConfig.provisionalAuthSecretMaster,
      PROVISIONAL_AUTH_DOMAIN: serverConfig.provisionalAuthDomain,
      JWT_EXPIRES_IN: serverConfig.jwtExpiresIn !== undefined ? String(serverConfig.jwtExpiresIn) : process.env.JWT_EXPIRES_IN,
      REFRESH_WINDOW_SEC:
        serverConfig.refreshWindowSec !== undefined ? String(serverConfig.refreshWindowSec) : process.env.REFRESH_WINDOW_SEC,
      REFRESH_SECRET_TTL_SEC:
        serverConfig.refreshSecretTtlSec !== undefined ? String(serverConfig.refreshSecretTtlSec) : process.env.REFRESH_SECRET_TTL_SEC,
      REFRESH_SESSION_TTL_SEC:
        serverConfig.refreshSessionTtlSec !== undefined
          ? String(serverConfig.refreshSessionTtlSec)
          : process.env.REFRESH_SESSION_TTL_SEC,
      PORT: String(serverConfig.port),
      LOG_LEVEL: process.env.LOG_LEVEL,
      BODY_LIMIT: process.env.BODY_LIMIT,
      BODY_WARN_THRESHOLD: process.env.BODY_WARN_THRESHOLD,
    };

    child = spawn(process.execPath, [startJsPath], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: "inherit",
    });
    if (!child.pid) {
      throw new Error("[example-server] failed to spawn revlm-server");
    }

    // Wait for server to accept connections, then create the demo user via HTTP.
    // サーバが接続受付できる状態になるまで待ち、HTTP経由でdemoユーザを作成する。
    await waitForHttpServer(serverUrl, 20_000);
    await createDemoUserIfPossible(serverUrl, env, cli);

    fs.writeFileSync(pidFile, String(process.pid), "utf8");
    const shutdown = async (exitCode: number) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("[example-server] Stopping example server...");
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      // Stop child server (revlm-server).
      // 子プロセス（revlm-server）を停止する。
      if (child && child.pid) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }

      if (mongod) {
        await mongod.stop();
      }
      process.exit(exitCode);
    };
    // Handle process signals and unexpected errors.
    // シグナル/例外で停止処理を行う。
    child.on("exit", (code, signal) => {
      // eslint-disable-next-line no-console
      console.log("[example-server] revlm-server exited", { code, signal });
      void shutdown(code === 0 ? 0 : 1);
    });

    process.on("SIGINT", () => void shutdown(0));
    process.on("SIGTERM", () => void shutdown(0));
    process.on("uncaughtException", async (error) => {
      console.error("Unhandled error starting sample server", error);
      await shutdown(1);
    });
    return;
  } catch (error) {
    // Ensure MongoMemoryServer is stopped on failure.
    // 失敗時はMongoMemoryServerを確実に停止する。
    if (mongod) {
      await mongod.stop();
    }
    console.error("Failed to start example server", error);
    process.exit(1);
  }
}

run();
