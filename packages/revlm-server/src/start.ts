import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
import { startServer, stopServer, ServerConfig, serverConfigDefaults } from './server';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function getServerVersion(): string {
  try {
    const pkg = require('../package.json');
    if (pkg && typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore: runtime may not expose package.json
  }
  return 'unknown';
}

function toBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v === 'true' || v === '1';
}

function toNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toNumberStrict(name: string): number | undefined {
  const v = getEnvOrUndefined(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number of seconds`);
  }
  if (n < 0) {
    throw new Error(`${name} must be >= 0`);
  }
  return n;
}

function getEnvOrUndefined(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  return v;
}

function normalizeLogLevel(value?: string): LogLevel {
  if (!value) return 'info';
  const lowered = value.toLowerCase();
  if (lowered === 'true' || lowered === '1') return 'debug';
  if (lowered === 'false' || lowered === '0') return 'error';
  if (lowered === 'error' || lowered === 'warn' || lowered === 'info' || lowered === 'debug') {
    return lowered as LogLevel;
  }
  return 'info';
}

function maskSecret(value?: string): string | undefined {
  if (!value) return undefined;
  return `<...:${value.length}>`;
}

async function main() {
  const raw: Record<string, any> = {
    mongoUri: getEnvOrUndefined('MONGO_URI'),
    usersDbName: getEnvOrUndefined('USERS_DB_NAME'),
    usersCollectionName: getEnvOrUndefined('USERS_COLLECTION_NAME'),
    provisionalLoginEnabled: toBool(getEnvOrUndefined('PROVISIONAL_LOGIN_ENABLED')),
    provisionalAuthId: getEnvOrUndefined('PROVISIONAL_AUTH_ID'),
    provisionalAuthSecretMaster: getEnvOrUndefined('PROVISIONAL_AUTH_SECRET_MASTER'),
    provisionalAuthDomain: getEnvOrUndefined('PROVISIONAL_AUTH_DOMAIN'),
    jwtSecret: getEnvOrUndefined('JWT_SECRET'),
    jwtExpiresIn: toNumberStrict('JWT_EXPIRES_IN'),
    refreshWindowSec: toNumberStrict('REFRESH_WINDOW_SEC'),
    refreshSecretTtlSec: toNumberStrict('REFRESH_SECRET_TTL_SEC'),
    port: toNumber(getEnvOrUndefined('PORT')),
    refreshSecretSigningKey: getEnvOrUndefined('REFRESH_SECRET_SIGNING_KEY'),
    // log level: 'error' | 'warn' | 'info' | 'debug'
    logLevel: getEnvOrUndefined('LOG_LEVEL'),
  };

  // Remove undefined entries so optional properties are omitted (satisfies exactOptionalPropertyTypes)
  const cfgPartial: Partial<ServerConfig> = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  ) as Partial<ServerConfig>;

  try {
    const initLogLevel = normalizeLogLevel(raw.logLevel);
    const mergedForLog: ServerConfig = {
      ...(serverConfigDefaults as Partial<ServerConfig>),
      ...(cfgPartial as Partial<ServerConfig>),
    } as ServerConfig;
    const hasDefault = (key: keyof ServerConfig) => Object.prototype.hasOwnProperty.call(serverConfigDefaults, key);
    const withDefault = (key: keyof ServerConfig, rawValue: unknown, value: unknown) => {
      if (rawValue === undefined && hasDefault(key)) {
        return `${String(value)} [default]`;
      }
      return value;
    };
    const resolvedPort = Number.isFinite(mergedForLog.port) ? mergedForLog.port : 0;
    if (initLogLevel === 'debug' || initLogLevel === 'info') {
      console.log('🚀 Revlm Server Init', {
        version: getServerVersion(),
        'MONGO_URI(mongoUri)': maskSecret(mergedForLog.mongoUri),
        'USERS_DB_NAME(usersDbName)': mergedForLog.usersDbName,
        'USERS_COLLECTION_NAME(usersCollectionName)': mergedForLog.usersCollectionName,
        'PROVISIONAL_LOGIN_ENABLED(provisionalLoginEnabled)': withDefault('provisionalLoginEnabled', raw.provisionalLoginEnabled, mergedForLog.provisionalLoginEnabled),
        'PROVISIONAL_AUTH_ID(provisionalAuthId)': mergedForLog.provisionalAuthId,
        'PROVISIONAL_AUTH_SECRET_MASTER(provisionalAuthSecretMaster)': maskSecret(mergedForLog.provisionalAuthSecretMaster),
        'PROVISIONAL_AUTH_DOMAIN(provisionalAuthDomain)': mergedForLog.provisionalAuthDomain,
        'JWT_SECRET(jwtSecret)': maskSecret(mergedForLog.jwtSecret),
        'JWT_EXPIRES_IN(jwtExpiresIn)': withDefault('jwtExpiresIn', raw.jwtExpiresIn, mergedForLog.jwtExpiresIn),
        'REFRESH_WINDOW_SEC(refreshWindowSec)': withDefault('refreshWindowSec', raw.refreshWindowSec, mergedForLog.refreshWindowSec),
        'REFRESH_SECRET_TTL_SEC(refreshSecretTtlSec)': withDefault('refreshSecretTtlSec', raw.refreshSecretTtlSec, mergedForLog.refreshSecretTtlSec),
        'PORT(port)': raw.port === undefined ? `${resolvedPort} [default]` : resolvedPort,
        'REFRESH_SECRET_SIGNING_KEY(refreshSecretSigningKey)': maskSecret(mergedForLog.refreshSecretSigningKey),
        'LOG_LEVEL(logLevel)': withDefault('logLevel', raw.logLevel, initLogLevel),
      });
    }
    await startServer(cfgPartial as ServerConfig);
    console.log('startServer called successfully');
    // Attach shutdown handlers only after successful start (Ctrl+C will trigger SIGINT)
    const shutdown = async (signal?: string, err?: any) => {
      if (signal) console.log(`Received ${signal}, shutting down...`);
      if (err) console.log('Shutdown triggered by error - Error name:', err && err.name, 'Error message:', err && err.message);
      try {
        await stopServer();
        console.log('Server stopped cleanly');
        process.exit(0);
      } catch (stopErr: any) {
        console.log('stopServer failed - Error name:', stopErr && stopErr.name, 'Error message:', stopErr && stopErr.message);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (ex) => {
      console.log('uncaughtException - Error name:', ex && ex.name, 'Error message:', ex && ex.message);
      shutdown(undefined, ex);
    });
    process.on('unhandledRejection', (reason: any) => {
      console.log('unhandledRejection -', reason && (reason.name || ''), reason && reason.message ? reason.message : reason);
      shutdown(undefined, reason);
    });
  } catch (err: any) {
    console.log('start failed - Error name:', err && err.name, 'Error message:', err && err.message);
    if (err && err.stack) console.log(err.stack);
    process.exit(1);
  }
}

void main();
