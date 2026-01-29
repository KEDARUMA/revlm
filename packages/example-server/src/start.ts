import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startServer, stopServer } from '@kedaruma/revlm-server/server';

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

// Parse `--key value` style CLI arguments.
// `--key value` 形式のCLI引数を解析する。
function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
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
  return configured ? path.resolve(process.cwd(), configured) : path.resolve(process.cwd(), '.example-server.pid');
}

// Ensure stale PID files are cleared before start.
// 起動前に古いPIDファイルを掃除する。
function clearStalePidFile(pidFile: string) {
  if (!fs.existsSync(pidFile)) return;
  const raw = fs.readFileSync(pidFile, 'utf8').trim();
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
  return value === '1' || value.toLowerCase() === 'true';
}

// Snapshot environment variables for configuration.
// 環境変数を設定用に読み取る。
function readEnv(): EnvConfig {
  return {
    usersDbName: process.env.USERS_DB_NAME,
    usersCollectionName: process.env.USERS_COLLECTION_NAME,
    jwtSecret: process.env.JWT_SECRET,
    refreshSecretSigningKey: process.env.REFRESH_SECRET_SIGNING_KEY,
    provisionalLoginEnabled: process.env.PROVISIONAL_LOGIN_ENABLED,
    provisionalAuthId: process.env.PROVISIONAL_AUTH_ID,
    provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER,
    provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    refreshWindowSec: process.env.REFRESH_WINDOW_SEC,
    refreshSecretTtlSec: process.env.REFRESH_SECRET_TTL_SEC,
    refreshSessionTtlSec: process.env.REFRESH_SESSION_TTL_SEC,
    port: process.env.PORT,
  };
}

// Start in-memory MongoDB + revlm-server, then wait for signals.
// オンメモリMongoDB + revlm-server を起動しシグナル待機する。
async function run() {
  const pidFile = getPidFilePath();
  // Load .env (or custom env file).
  // .env（または指定ファイル）を読み込む。
  const envFile = process.env.EXAMPLE_SERVER_ENV
    ? path.resolve(process.cwd(), process.env.EXAMPLE_SERVER_ENV)
    : path.resolve(process.cwd(), '.env');
  loadEnv({ path: envFile, override: true });
  const cli = parseArgs(process.argv.slice(2));
  const env = readEnv();
  // MongoMemoryServer instance for the sample backend.
  // サンプル用MongoMemoryServerインスタンス。
  let mongod: MongoMemoryServer | undefined;

  try {
    // Guard against stale PID files before boot.
    // 起動前に古いPIDファイルを整理する。
    clearStalePidFile(pidFile);
    // Start in-memory MongoDB for example usage.
    // サンプル用にオンメモリMongoDBを起動する。
    mongod = await MongoMemoryServer.create({
      instance: {
        dbName: cli.usersDbName || env.usersDbName || 'revlm',
      },
    });
    const mongoUri = mongod.getUri();

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

    // Start revlm-server and write PID for later stop.
    // revlm-server を起動し、停止用にPIDを書き出す。
    const server = await startServer(serverConfig as any);
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
    const shutdown = async () => {
      console.log('Stopping example server...');
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
      await stopServer();
      if (mongod) {
        await mongod.stop();
      }
      process.exit(0);
    };
    // Handle process signals and unexpected errors.
    // シグナル/例外で停止処理を行う。
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', async (error) => {
      console.error('Unhandled error starting sample server', error);
      await shutdown();
    });
    return server;
  } catch (error) {
    // Ensure MongoMemoryServer is stopped on failure.
    // 失敗時はMongoMemoryServerを確実に停止する。
    if (mongod) {
      await mongod.stop();
    }
    console.error('Failed to start example server', error);
    process.exit(1);
  }
}

run();
