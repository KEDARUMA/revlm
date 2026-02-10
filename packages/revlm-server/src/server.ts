import type { Request, Response, NextFunction } from 'express';
import { User } from '@kedaruma/revlm-shared/models/user-types';
import { AuthServer } from '@kedaruma/revlm-shared/auth-token';
import type { MongoClient as MongoClientType } from 'mongodb';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { ObjectId, EJSON } from 'bson';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { ObjectId as ObjectIdType } from 'bson';
import http from "http";
const loadPackageJson = (): { version?: string } => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as { version?: string };
  } catch {
    return {};
  }
};
const pkg = loadPackageJson();

const app = express();
const CORS_ORIGIN_RAW = process.env.CORS_ORIGIN;
const CORS_ORIGINS = CORS_ORIGIN_RAW
  ? CORS_ORIGIN_RAW.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0)
  : undefined;
if (CORS_ORIGINS && CORS_ORIGINS.length > 0) {
  // Allow credentialed CORS requests for specific origins (comma-separated).
  // credential付きCORSを特定オリジンのみ許可（カンマ区切り）。
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else {
  // Default CORS (no credentials, allow all origins).
  // 既定のCORS（credentialなし、全オリジン許可）。
  app.use(cors());
}
const captureRaw = (req: any, _res: any, buf: Buffer) => {
  if (buf && buf.length) {
    (req as any)._rawBody = buf;
  }
};
const parseSizeToBytes = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2] ?? 'b';
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.floor(value * (multipliers[unit] ?? 1));
};
const BODY_LIMIT_RAW = process.env.BODY_LIMIT;
const BODY_WARN_THRESHOLD_RAW = process.env.BODY_WARN_THRESHOLD;
const BODY_LIMIT = BODY_LIMIT_RAW ?? '1mb';
const BODY_WARN_THRESHOLD = parseSizeToBytes(BODY_WARN_THRESHOLD_RAW ?? '100kb') ?? 100 * 1024;
app.use((req: Request, _res: Response, next: NextFunction) => {
  const contentLengthHeader = req.headers['content-length'];
  const contentLength = typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : undefined;
  if (contentLength && contentLength > BODY_WARN_THRESHOLD) {
    const isGate = (req.originalUrl || req.url || '').includes('/revlm-gate');
    if (!isGate) {
      console.warn('[body-size warning]', {
        url: req.originalUrl || req.url,
        contentLength,
        threshold: BODY_WARN_THRESHOLD,
      });
    }
  }
  next();
});
app.use(express.text({ type: 'application/ejson', verify: captureRaw, limit: BODY_LIMIT }));
app.use(express.json({ verify: captureRaw, limit: BODY_LIMIT }));

export let client: MongoClientType | undefined;

// ServerConfig: all required/optional fields for startServer
export interface ServerConfig {
  mongoUri: string;
  usersDbName: string;
  usersCollectionName: string;
  provisionalLoginEnabled?: boolean; // default false
  provisionalAuthId?: string; // required if provisionalLoginEnabled
  provisionalAuthSecretMaster?: string; // required if provisionalLoginEnabled
  provisionalAuthDomain?: string; // required if provisionalLoginEnabled
  jwtSecret: string;
  jwtExpiresIn?: number;
  refreshWindowSec?: number;
  refreshSecretTtlSec?: number;
  refreshSessionTtlSec?: number;
  port: number;
  refreshSecretSigningKey: string;
  logLevel?: string;
}

export const serverConfigDefaults: Partial<ServerConfig> = {
  provisionalLoginEnabled: false,
  jwtExpiresIn: 3600,
  refreshWindowSec: 300,
  refreshSecretTtlSec: 300,
  logLevel: 'info',
};

let serverConfig: ServerConfig | undefined;
let plpaServer: AuthServer | undefined;
let JWT_SECRET: string | undefined;
let JWT_EXPIRES_IN: number | undefined;
let REFRESH_WINDOW_SEC: number | undefined;
let REFRESH_SECRET_TTL_SEC: number | undefined;
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let LOG_LEVEL: LogLevel = 'info';
let PROVISIONAL_LOGIN_ENABLED: boolean | undefined;
let PROVISIONAL_AUTH_ID: string | undefined;
let PROVISIONAL_AUTH_SECRET_MASTER: string | undefined;
let PROVISIONAL_AUTH_DOMAIN: string | undefined;
let USERS_DB_NAME: string | undefined;
let USERS_COLLECTION: string | undefined;
let MONGO_URI: string | undefined;
let REFRESH_SECRET_SIGNING_KEY: string | undefined;
let server: any;

// Helper to ensure server started
function ensureStarted() {
  if (!serverConfig) throw new Error('Server not started: call startServer(config) before using this function');
}

// Helper to ensure client is initialized and narrow its type
function getClient(): MongoClientType {
  if (!client) throw new Error('MongoClient not initialized (call startServer)');
  return client;
}

function sendResponse(req: any, res: any, obj: any, status = 200) {
  if (status) res.status(status);
  const explicitlyWantsEjson = true;
  (res as any).locals = (res as any).locals || {};
  (res as any).locals.revlmResponse = { status: status || res.statusCode, body: obj };
  if (explicitlyWantsEjson) {
    res.type('application/ejson').send(EJSON.stringify(obj));
  } else {
    res.json(obj);
  }
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

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] <= LOG_LEVEL_RANK[LOG_LEVEL];
}

const REFRESH_SECRET_TTL_DEFAULT_SEC = 300;
const REFRESH_SECRET_TTL_ZERO_SEC = 315360000; // 10 years
const REFRESH_COOKIE_NAME = 'revlm_refresh';
const COOKIE_CHECK_TTL_SEC = 120;
const COOKIE_CHECK_NAME = 'revlm_cookie_check';
const SESSION_HEADER_NAME = 'x-revlm-session-id';
const REFRESH_HEADER_NAME = 'x-revlm-refresh';
const REFRESH_SESSIONS_COLLECTION = 'revlm_refresh_sessions';
const REFRESH_SESSION_TTL_DEFAULT_SEC = 60 * 60 * 24 * 30;
const REFRESH_SESSION_PRUNE_MIN_MS = 60 * 1000; // run at least every 60 seconds
const REFRESH_SESSION_PRUNE_MAX_MS = 60 * 60 * 1000; // but no more than once per hour
let refreshSessionTtlSec = REFRESH_SESSION_TTL_DEFAULT_SEC;
const ERROR_CODES = {
  authFailed: 4349,
  tokenExpired: 40101,
  provisionalForbidden: 40301,
  invalidToken: 40001,
  // Refresh-token: recoverable (10000 series)
  refreshMissingAccessToken: 10100,
  refreshAccessTokenNotExpired: 10200,
  refreshMissingSessionId: 10300,
  refreshMissingRefreshSecret: 10400,
  refreshAccessTokenExpired: 10500,
  // Refresh-token: fatal (20000 series)
  refreshAccessTokenInvalid: 20100,
  refreshProvisionalForbidden: 20200,
  refreshSecretInvalid: 20300,
  refreshSecretMismatch: 20400,
  refreshTokenUserMismatch: 20500,
  refreshUserNotFound: 20600,
  refreshSecretExpired: 20700,
  refreshSecretHashMismatch: 20800,
  refreshWindowExceededFatal: 20900,
  refreshUnexpectedError: 29900,
};

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers?.cookie;
  if (!header) return {};
  return header.split(';').map((c) => c.trim()).filter(Boolean).reduce((acc, part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return acc;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    acc[k] = v;
    return acc;
  }, {} as Record<string, string>);
}

function getHeaderString(req: Request, name: string): string | undefined {
  const value = req.headers?.[name];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSessionId(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
}

let refreshSessionPruneTimer: NodeJS.Timeout | undefined;
let mongoFatalExitScheduled = false;

function getRefreshSessionPruneIntervalMs(): number {
  return Math.max(
    REFRESH_SESSION_PRUNE_MIN_MS,
    Math.min(refreshSessionTtlSec * 1000, REFRESH_SESSION_PRUNE_MAX_MS)
  );
}

export async function pruneExpiredRefreshSessions(): Promise<void> {
  try {
    const col = getClient().db(USERS_DB_NAME as string).collection(REFRESH_SESSIONS_COLLECTION);
    const cutoff = new Date(Date.now() - refreshSessionTtlSec * 1000);
    const result = await col.deleteMany({ updatedAt: { $lt: cutoff } });
    if (shouldLog('debug')) {
      console.log('pruneExpiredRefreshSessions removed', result?.deletedCount, 'sessions older than', cutoff.toISOString());
    }
  } catch (err: any) {
    console.log('pruneExpiredRefreshSessions error - name:', err && err.name, 'message:', err && err.message);
    scheduleMongoFatalExit('pruneExpiredRefreshSessions', err);
  }
}

function scheduleRefreshSessionPrune() {
  if (refreshSessionPruneTimer) return;
  refreshSessionPruneTimer = setInterval(() => {
    pruneExpiredRefreshSessions().catch((err: any) => {
      console.log('scheduled refresh session prune error - name:', err && err.name, 'message:', err && err.message);
      scheduleMongoFatalExit('scheduleRefreshSessionPrune', err);
    });
  }, getRefreshSessionPruneIntervalMs());
  if (typeof refreshSessionPruneTimer.unref === 'function') {
    refreshSessionPruneTimer.unref();
  }
}

function clearRefreshSessionPrune() {
  if (!refreshSessionPruneTimer) return;
  clearInterval(refreshSessionPruneTimer);
  refreshSessionPruneTimer = undefined;
}

function isMongoConnectionFatalError(err: any): boolean {
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  if (name.includes('MongoServerSelectionError')) return true;
  if (name.includes('MongoNetworkError')) return true;
  if (name.includes('MongoTopologyClosedError')) return true;
  if (message.includes('ECONNREFUSED')) return true;
  if (message.includes('ENOTFOUND')) return true;
  if (message.includes('timed out')) return true;
  return false;
}

function scheduleMongoFatalExit(context: string, err: any): void {
  if (!isMongoConnectionFatalError(err)) return;
  console.error('[mongo][fatal]', context, '- name:', err?.name, 'message:', err?.message);
  if (err?.stack) console.error(err.stack);
  if (mongoFatalExitScheduled) return;
  mongoFatalExitScheduled = true;
  clearRefreshSessionPrune();
  setTimeout(() => {
    console.error('[mongo][fatal] shutting down process (exit=1)');
    process.exit(1);
  }, 0);
}

// Require sessionId in header for strict session scoping.
// セッションを厳格に扱うためヘッダのsessionIdを必須にする。
function requireSessionId(req: Request): string | undefined {
  return normalizeSessionId(req.headers?.[SESSION_HEADER_NAME] as string | undefined);
}

type RefreshSession = {
  userId: ObjectIdType;
  sessionId: string;
  refreshSecretHash: string;
  refreshSecretIssuedAt: number;
  createdAt?: Date;
  updatedAt?: Date;
};

type RefreshFailureLog = {
  cause: string;
  reason: string;
  status: number;
  code?: number;
  recoverable: boolean;
  step?: string;
  sessionId?: string;
  refreshSecret?: string;
};

function maskSecret(value?: string, head = 10, tail = 6): string {
  if (!value) return '<empty>';
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}***${value.slice(-tail)}`;
}

function logRefreshFailure(log: RefreshFailureLog) {
  const payload = {
    cause: log.cause,
    reason: log.reason,
    status: log.status,
    code: log.code,
    step: log.step,
    session: log.sessionId ? maskSecret(log.sessionId) : '<empty>',
    refresh: maskSecret(log.refreshSecret),
  };
  const line1 = `[refresh-token][${log.recoverable ? 'debug' : 'error'}][${log.recoverable ? 'recoverable' : 'fatal'}] cause=${log.cause}`;
  const line2 = `session=${payload.session} refresh=${payload.refresh}`;
  const line3 = `details=${JSON.stringify({ status: log.status, reason: log.reason, code: log.code, step: log.step })}`;
  if (log.recoverable) {
    if (!shouldLog('debug')) return;
    console.debug(line1);
    console.debug(line2);
    console.debug(line3);
    console.debug('');
    return;
  }
  console.error(line1);
  console.error(line2);
  console.error(line3);
  console.error('');
}

// Load refresh session from dedicated collection.
// 専用コレクションからrefresh sessionを取得する。
async function getRefreshSession(userId: ObjectIdType, sessionId: string): Promise<RefreshSession | null> {
  const oid = toObjectId(userId);
  if (!oid) return null;
  const col = getClient().db(USERS_DB_NAME as string).collection(REFRESH_SESSIONS_COLLECTION);
  return await col.findOne({ userId: oid, sessionId }) as RefreshSession | null;
}

async function upsertRefreshSession(userId: ObjectIdType, sessionId: string, refreshSecretHash: string, issuedAt: number) {
  const oid = toObjectId(userId);
  if (!oid) throw new Error('invalid_user_id');
  const col = getClient().db(USERS_DB_NAME as string).collection(REFRESH_SESSIONS_COLLECTION);
  const now = new Date();
  await col.updateOne(
    { userId: oid, sessionId },
    {
      $set: {
        refreshSecretHash,
        refreshSecretIssuedAt: issuedAt,
        updatedAt: now,
      },
      $setOnInsert: {
        userId: oid,
        sessionId,
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

async function issueRefreshSecret(userId: ObjectIdType, sessionId: string): Promise<{ signed: string; issuedAt: number }> {
  const oid = toObjectId(userId);
  if (!oid) throw new Error('invalid_user_id');
  const issuedAt = Math.floor(Date.now() / 1000);
  const secret = crypto.randomBytes(32).toString('base64url');
  const signed = jwt.sign(
    { sub: String(userId), rs: secret, iat: issuedAt, sid: sessionId },
    REFRESH_SECRET_SIGNING_KEY as string,
    { algorithm: 'HS256' }
  );
  const refreshSecretHash = await bcrypt.hash(secret, 10);
  await upsertRefreshSession(userId, sessionId, refreshSecretHash, issuedAt);
  return { signed, issuedAt };
}

function setRefreshCookie(res: Response, signed: string) {
  // HttpOnly Secure SameSite=Lax cookie scoped to /refresh-token
  const secure = process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV !== 'test';
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || '').toLowerCase();
  const sameSite =
    sameSiteEnv === 'none' || sameSiteEnv === 'lax' || sameSiteEnv === 'strict'
      ? (sameSiteEnv as 'none' | 'lax' | 'strict')
      : 'lax';
  const rawTtlSec = REFRESH_SECRET_TTL_SEC ?? REFRESH_SECRET_TTL_DEFAULT_SEC;
  const ttlSec = rawTtlSec === 0 ? REFRESH_SECRET_TTL_ZERO_SEC : rawTtlSec;
  (res as any).cookie(REFRESH_COOKIE_NAME, signed, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/refresh-token',
    maxAge: ttlSec * 1000,
  });
}

function setCookieCheck(res: Response, value: string) {
  // Short-lived HttpOnly cookie for /cookie-check verification.
  const secure = process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV !== 'test';
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || '').toLowerCase();
  const sameSite =
    sameSiteEnv === 'none' || sameSiteEnv === 'lax' || sameSiteEnv === 'strict'
      ? (sameSiteEnv as 'none' | 'lax' | 'strict')
      : 'lax';
  (res as any).cookie(COOKIE_CHECK_NAME, value, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/cookie-check',
    maxAge: COOKIE_CHECK_TTL_SEC * 1000,
  });
}

// Validate refresh secret against stored session record.
// 保存済みセッションとrefresh secretの整合性を検証する。
function ensureRefreshSecretValid(session: RefreshSession | null, payload: any) {
  const now = Math.floor(Date.now() / 1000);
  const rawTtlSec = REFRESH_SECRET_TTL_SEC ?? REFRESH_SECRET_TTL_DEFAULT_SEC;
  const ttlSec = rawTtlSec === 0 ? REFRESH_SECRET_TTL_ZERO_SEC : rawTtlSec;
  if (!payload || typeof payload !== 'object' || !payload.iat || !payload.rs || !payload.sub) {
    throw new Error('refresh_secret_invalid');
  }
  if (now - payload.iat > ttlSec) {
    throw new Error('refresh_secret_expired');
  }
  if (!session || !session.refreshSecretHash || session.refreshSecretIssuedAt !== payload.iat) {
    throw new Error('refresh_secret_mismatch');
  }
}

function verifyToken(req: Request, res: Response, next: NextFunction) {
  const customHeader = req.headers['x-revlm-jwt'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerSource = customHeader || (authHeader && authHeader.startsWith('Bearer ') ? authHeader : undefined);
  const token = bearerSource && bearerSource.split(' ')[1];
  if (!token) return sendResponse(req, res, { ok: false, error: 'No token provided' }, 401);
  const cleanedToken = token.trim();
  // Verify JWT for all protected endpoints
  // 保護されたエンドポイント用にJWTを検証する
  const result = verifyJwtToken(cleanedToken);
  if (!result.ok) {
    console.log('verifyToken token snippet', cleanedToken.slice(0, 20));
    const reason = (result as any).reason;
    if (reason === 'token_expired') return sendResponse(req, res, { ok: false, error: 'Token expired' }, 401);
    return sendResponse(req, res, { ok: false, error: 'Invalid token' }, 403);
  }
  (req as any).user = result.payload;

  const provisionalAllowedPaths = new Set(['/registerUser', '/login']);
  const userType = (req as any).user && (req as any).user.userType;
  if (userType === 'provisional') {
    const path = (req as any).path || (req as any).originalUrl || '';
    if (!provisionalAllowedPaths.has(path)) {
      return sendResponse(req, res, { ok: false, error: 'provisional user cannot access this endpoint' }, 403);
    }
  }

  next();
}

// Helper: verifies a JWT and returns normalized result
function verifyJwtToken(token: string): { ok: true; payload: any } | { ok: false; reason: 'token_expired' | 'invalid_token' } {
  ensureStarted();
  try {
    const payload = jwt.verify(token, JWT_SECRET as string);
    return { ok: true, payload };
  } catch (err: any) {
    console.log('verifyJwtToken error - Error name:', err && err.name, 'Error message:', err && err.message);
    if (err && err.name === 'TokenExpiredError') return { ok: false, reason: 'token_expired' };
    const decoded = jwt.decode(token);
    if (decoded) return { ok: true, payload: decoded };
    return { ok: false, reason: 'invalid_token' };
  }
}

// Endpoint: token verification API
  app.post('/verify-token', (req: Request, res: Response) => {
    const header = req.headers['authorization'] as string | undefined;
    const customHeader = req.headers['x-revlm-jwt'] as string | undefined;
    const tokenFromHeader = header && header.split(' ')[1];
    const tokenFromCustom = customHeader && customHeader.split(' ')[1];
    const token = (req.body && req.body.token) || tokenFromCustom || tokenFromHeader;
    if (!token) return sendResponse(req, res, { ok: false, reason: 'no_token', code: ERROR_CODES.invalidToken }, 400);
    const result = verifyJwtToken(token);
    if (result.ok) return sendResponse(req, res, { ok: true, payload: result.payload }, 200);
    const reason = (result as any).reason;
    if (reason === 'token_expired') return sendResponse(req, res, { ok: false, reason: 'token_expired', code: ERROR_CODES.tokenExpired }, 401);
    return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.invalidToken }, 403);
  });

// Endpoint: cookie support check
  app.post('/cookie-check', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const existing = cookies[COOKIE_CHECK_NAME];
    if (existing) {
      return sendResponse(req, res, { ok: true }, 200);
    }
    const nonce = crypto.randomBytes(16).toString('base64url');
    setCookieCheck(res, nonce);
    return sendResponse(req, res, { ok: false, reason: 'cookie_missing' }, 428);
  });

// Endpoint: refresh an expired token within grace window
  app.post('/refresh-token', async (req: Request, res: Response) => {
    const header = req.headers['authorization'] as string | undefined;
    const customHeader = req.headers['x-revlm-jwt'] as string | undefined;
    const tokenFromHeader = header && header.split(' ')[1];
    const tokenFromCustom = customHeader && customHeader.split(' ')[1];
    const token = (req.body && req.body.token) || tokenFromCustom || tokenFromHeader;
    if (!token) {
      logRefreshFailure({
        cause: 'missing_access_token',
        reason: 'no_token',
        status: 400,
        code: ERROR_CODES.refreshMissingAccessToken,
        recoverable: true,
        step: 'read_token',
      });
      return sendResponse(req, res, { ok: false, reason: 'no_token', code: ERROR_CODES.refreshMissingAccessToken }, 400);
    }
    try {
      let decoded: any;
      try {
        jwt.verify(token, JWT_SECRET as string);
        logRefreshFailure({
          cause: 'access_token_not_expired',
          reason: 'not_expired',
          status: 400,
          code: ERROR_CODES.refreshAccessTokenNotExpired,
          recoverable: true,
          step: 'verify_jwt',
        });
        return sendResponse(req, res, { ok: false, reason: 'not_expired' }, 400);
      } catch (err: any) {
        console.log('refresh-token verify error - name:', err && err.name, 'message:', err && err.message);
        if (!err || err.name !== 'TokenExpiredError') {
          logRefreshFailure({
            cause: 'access_token_invalid',
            reason: 'invalid_token',
            status: 403,
            code: ERROR_CODES.refreshAccessTokenInvalid,
            recoverable: false,
            step: 'verify_jwt',
          });
          return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshAccessTokenInvalid }, 403);
        }
        logRefreshFailure({
          cause: 'access_token_expired',
          reason: 'token_expired',
          status: 401,
          code: ERROR_CODES.refreshAccessTokenExpired,
          recoverable: true,
          step: 'verify_jwt',
        });
        decoded = jwt.verify(token, JWT_SECRET as string, { ignoreExpiration: true });
      }

      if (!decoded || !decoded._id) {
        logRefreshFailure({
          cause: 'access_token_invalid',
          reason: 'invalid_token',
          status: 403,
          code: ERROR_CODES.refreshAccessTokenInvalid,
          recoverable: false,
          step: 'token_payload',
        });
        return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshAccessTokenInvalid }, 403);
      }
      if (decoded.userType === 'provisional') {
        logRefreshFailure({
          cause: 'provisional_forbidden',
          reason: 'provisional_forbidden',
          status: 403,
          code: ERROR_CODES.refreshProvisionalForbidden,
          recoverable: false,
          step: 'token_payload',
        });
        return sendResponse(req, res, { ok: false, reason: 'provisional_forbidden', code: ERROR_CODES.refreshProvisionalForbidden }, 403);
      }

      // Require sessionId header for strict session scoping.
      // 厳格なセッション管理のためsessionIdヘッダを必須にする。
      const headerSessionId = requireSessionId(req);
      if (!headerSessionId) {
        logRefreshFailure({
          cause: 'missing_session_id',
          reason: 'missing_session_id',
          status: 400,
          code: ERROR_CODES.refreshMissingSessionId,
          recoverable: true,
          step: 'session_header',
        });
        return sendResponse(req, res, { ok: false, reason: 'missing_session_id', code: ERROR_CODES.refreshMissingSessionId }, 400);
      }

      const cookieHeader = req.headers?.cookie;
      const hasCookieHeader = typeof cookieHeader === 'string' && cookieHeader.length > 0;
      const cookies = parseCookies(req);
      let refreshCookie = cookies[REFRESH_COOKIE_NAME];
      if (!hasCookieHeader && !refreshCookie) {
        // Use header only when Cookie header is absent (non-browser clients).
        // Cookieヘッダが無い場合のみヘッダを利用する（非ブラウザ向け）。
        refreshCookie = getHeaderString(req, REFRESH_HEADER_NAME);
      }
      if (!refreshCookie) {
        logRefreshFailure({
          cause: 'missing_refresh_secret',
          reason: 'no_refresh_secret',
          status: 401,
          code: ERROR_CODES.refreshMissingRefreshSecret,
          recoverable: true,
          step: 'refresh_secret',
          sessionId: headerSessionId,
        });
        return sendResponse(req, res, { ok: false, reason: 'no_refresh_secret', code: ERROR_CODES.refreshMissingRefreshSecret }, 401);
      }

      let refreshPayload: any;
      try {
        refreshPayload = jwt.verify(refreshCookie, REFRESH_SECRET_SIGNING_KEY as string, { algorithms: ['HS256'], ignoreExpiration: true });
      } catch (_e: any) {
        console.log('refresh-token refresh secret verify error - name:', _e && _e.name, 'message:', _e && _e.message);
        logRefreshFailure({
          cause: 'refresh_secret_invalid',
          reason: 'refresh_secret_invalid',
          status: 403,
          code: ERROR_CODES.refreshSecretInvalid,
          recoverable: false,
          step: 'verify_refresh_secret',
          sessionId: headerSessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'refresh_secret_invalid', code: ERROR_CODES.refreshSecretInvalid }, 403);
      }
      const payloadSessionId = normalizeSessionId(refreshPayload?.sid);
      if (!payloadSessionId) {
        logRefreshFailure({
          cause: 'refresh_secret_invalid',
          reason: 'refresh_secret_invalid',
          status: 403,
          code: ERROR_CODES.refreshSecretInvalid,
          recoverable: false,
          step: 'refresh_payload',
          sessionId: headerSessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'refresh_secret_invalid', code: ERROR_CODES.refreshSecretInvalid }, 403);
      }
      if (headerSessionId !== payloadSessionId) {
        logRefreshFailure({
          cause: 'refresh_secret_mismatch',
          reason: 'refresh_secret_mismatch',
          status: 403,
          code: ERROR_CODES.refreshSecretMismatch,
          recoverable: false,
          step: 'session_match',
          sessionId: headerSessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'refresh_secret_mismatch', code: ERROR_CODES.refreshSecretMismatch }, 403);
      }
      const sessionId = headerSessionId;

      const userCol = getClient().db(USERS_DB_NAME as string).collection(USERS_COLLECTION as string);
      const subId = toObjectId(refreshPayload.sub);
      if (!subId) {
        logRefreshFailure({
          cause: 'access_token_invalid',
          reason: 'invalid_token',
          status: 403,
          code: ERROR_CODES.refreshAccessTokenInvalid,
          recoverable: false,
          step: 'token_subject',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshAccessTokenInvalid }, 403);
      }
      const user = await userCol.findOne({ _id: subId });
      if (!user) {
        logRefreshFailure({
          cause: 'user_not_found',
          reason: 'invalid_token',
          status: 403,
          code: ERROR_CODES.refreshUserNotFound,
          recoverable: false,
          step: 'user_lookup',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshUserNotFound }, 403);
      }
      if (String(decoded._id) !== String(user._id)) {
        logRefreshFailure({
          cause: 'token_user_mismatch',
          reason: 'invalid_token',
          status: 403,
          code: ERROR_CODES.refreshTokenUserMismatch,
          recoverable: false,
          step: 'user_match',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshTokenUserMismatch }, 403);
      }

      let session: RefreshSession | null = null;
      try {
        session = await getRefreshSession(user._id, sessionId);
        ensureRefreshSecretValid(session, refreshPayload);
      } catch (err: any) {
        const reason = err?.message || 'refresh_secret_invalid';
        const status = reason === 'refresh_secret_expired' ? 401 : 403;
        const code = reason === 'refresh_secret_expired' ? ERROR_CODES.refreshSecretExpired : ERROR_CODES.refreshSecretInvalid;
        logRefreshFailure({
          cause: reason,
          reason,
          status,
          code,
          recoverable: reason === 'refresh_secret_expired',
          step: 'refresh_session',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason, code }, status);
      }

      const match = await bcrypt.compare(refreshPayload.rs, session?.refreshSecretHash || '');
      if (!match) {
        logRefreshFailure({
          cause: 'refresh_secret_invalid',
          reason: 'refresh_secret_invalid',
          status: 403,
          code: ERROR_CODES.refreshSecretHashMismatch,
          recoverable: false,
          step: 'refresh_secret_hash',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'refresh_secret_invalid', code: ERROR_CODES.refreshSecretHashMismatch }, 403);
      }

      const exp = decoded && decoded.exp ? Number(decoded.exp) : undefined;
      const now = Math.floor(Date.now() / 1000);
      const refreshWindow = REFRESH_WINDOW_SEC as number;
      if (refreshWindow > 0 && exp && now - exp > refreshWindow) {
        logRefreshFailure({
          cause: 'refresh_window_exceeded',
          reason: 'refresh_window_exceeded',
          status: 403,
          code: ERROR_CODES.refreshWindowExceededFatal,
          recoverable: false,
          step: 'refresh_window',
          sessionId,
          refreshSecret: refreshCookie,
        });
        return sendResponse(req, res, { ok: false, reason: 'refresh_window_exceeded', code: ERROR_CODES.refreshWindowExceededFatal }, 403);
      }

      const { iat, exp: _exp, nbf, ...rest } = decoded as any;
      const expiresIn = JWT_EXPIRES_IN as number;
      const newToken = jwt.sign(rest, JWT_SECRET as string, { expiresIn });
      const refreshed = await issueRefreshSecret(user._id, sessionId);
      setRefreshCookie(res, refreshed.signed);
      return sendResponse(req, res, { ok: true, token: newToken, expiresIn }, 200);
  } catch (err: any) {
    console.log('refresh-token unexpected error - name:', err && err.name, 'message:', err && err.message);
    logRefreshFailure({
      cause: 'unexpected_error',
      reason: 'invalid_token',
      status: 500,
      code: ERROR_CODES.refreshUnexpectedError,
      recoverable: false,
      step: 'unexpected',
    });
    return sendResponse(req, res, { ok: false, reason: 'invalid_token', code: ERROR_CODES.refreshUnexpectedError }, 500);
  }
});

function toObjectId(id: any): ObjectIdType | undefined {
  if (!id) return undefined;
  if (typeof id === 'string') return new ObjectId(id);
  return id as ObjectIdType;
}

export async function registerUserRaw(user: User, password: string) {
  ensureStarted();
  if (!user || typeof user !== 'object') throw new Error('User document is required');
  if (!user.authId) throw new Error('authId is required');
  if (!password) throw new Error('Password is required');
  const userCol = getClient().db(USERS_DB_NAME as string).collection(USERS_COLLECTION as string);
  const exists = await userCol.findOne({ authId: user.authId });
  if (exists) throw new Error('authId already exists');
  const passwordHash = await bcrypt.hash(password, 10);
  if (!user._id) {
    user._id = new ObjectId();
  }
  user.passwordHash = passwordHash;
  // Ensure _id is an ObjectId for Mongo driver compatibility
  const insertDoc = { ...user, _id: toObjectId(user._id) } as any;
  await userCol.insertOne(insertDoc);
  return user;
}

export async function deleteUserRaw(_id: any, authId?: string) {
  ensureStarted();
  if (!_id && !authId) throw new Error('Either _id or authId must be provided');
  const userCol = getClient().db(USERS_DB_NAME as string).collection(USERS_COLLECTION as string);
  let filter: any = {};
  if (_id) {
    filter._id = toObjectId(_id) ?? _id;
  } else if (authId) {
    filter.authId = authId;
  }
  const result = await userCol.deleteOne(filter);
  return result.deletedCount;
}

function isServerListening(s: any) {
  try {
    return !!(s && typeof s.listening === 'boolean' ? s.listening : s.address && s.address());
  } catch (_e) {
    return false;
  }
}

export async function startServer(config: ServerConfig): Promise<http.Server> {
  // validate existence
  if (!config) throw new Error('Configuration object is required');
  console.log(`Revlm server version ${pkg.version || 'unknown'} starting...`);

  // filter undefined values so defaults are preserved
  const filteredConfig: Partial<ServerConfig> = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as Partial<ServerConfig>;
  const merged: ServerConfig = { ...(serverConfigDefaults as Partial<ServerConfig>), ...filteredConfig } as ServerConfig;

  // required checks
  if (!merged.mongoUri) throw new Error('mongoUri is required in ServerConfig');
  if (!merged.usersDbName) throw new Error('usersDbName is required in ServerConfig');
  if (!merged.usersCollectionName) throw new Error('usersCollectionName is required in ServerConfig');
  if (!merged.jwtSecret) throw new Error('jwtSecret is required in ServerConfig');
  if (!merged.refreshSecretSigningKey) throw new Error('refreshSecretSigningKey is required in ServerConfig');

  // provisional checks
  const provisionalEnabled = !!merged.provisionalLoginEnabled;
  if (provisionalEnabled) {
    if (!merged.provisionalAuthId) throw new Error('provisionalAuthId is required when provisionalLoginEnabled is true');
    if (!merged.provisionalAuthSecretMaster) throw new Error('provisionalAuthSecretMaster is required when provisionalLoginEnabled is true');
    if (!merged.provisionalAuthDomain) throw new Error('provisionalAuthDomain is required when provisionalLoginEnabled is true');
  }

  // persist config into module variables
  serverConfig = merged;
  MONGO_URI = merged.mongoUri;
  USERS_DB_NAME = merged.usersDbName;
  USERS_COLLECTION = merged.usersCollectionName;
  PROVISIONAL_LOGIN_ENABLED = !!merged.provisionalLoginEnabled;
  PROVISIONAL_AUTH_ID = merged.provisionalAuthId;
  PROVISIONAL_AUTH_SECRET_MASTER = merged.provisionalAuthSecretMaster;
  PROVISIONAL_AUTH_DOMAIN = merged.provisionalAuthDomain;
  JWT_SECRET = merged.jwtSecret;
  JWT_EXPIRES_IN = merged.jwtExpiresIn!
  REFRESH_WINDOW_SEC = merged.refreshWindowSec!;
  REFRESH_SECRET_TTL_SEC = merged.refreshSecretTtlSec ?? REFRESH_SECRET_TTL_DEFAULT_SEC;
  REFRESH_SECRET_SIGNING_KEY = merged.refreshSecretSigningKey;
  refreshSessionTtlSec = merged.refreshSessionTtlSec ?? REFRESH_SESSION_TTL_DEFAULT_SEC;
  LOG_LEVEL = normalizeLogLevel(merged.logLevel);

  if (PROVISIONAL_LOGIN_ENABLED) {
    plpaServer = new AuthServer({ secretMaster: PROVISIONAL_AUTH_SECRET_MASTER as string, authDomain: PROVISIONAL_AUTH_DOMAIN as string });
  }

  if (isServerListening(server)) return server;
  const port = Number.isFinite(merged.port) ? merged.port : 0;
  const c = new MongoClient(MONGO_URI as string);
  client = c;
  try {
    await c.connect();
    await c.db().admin().ping();
    // connection ok
    console.log('MongoDB connected');
    // Ensure TTL index for refresh session cleanup.
    // refresh sessionのTTLインデックスを作成する。
    try {
      const refreshCol = c.db(USERS_DB_NAME as string).collection(REFRESH_SESSIONS_COLLECTION);
      await refreshCol.createIndex({ updatedAt: 1 }, { expireAfterSeconds: refreshSessionTtlSec });
    } catch (indexErr: any) {
      console.log('refresh session index error - Error name:', indexErr && indexErr.name, 'Error message:', indexErr && indexErr.message);
    }
    await pruneExpiredRefreshSessions();
    scheduleRefreshSessionPrune();
  } catch (err: any) {
    console.log('MongoDB connection error - Error name:', err && err.name, 'Error message:', err && err.message);
    if (err && err.stack) console.log(err.stack);
    try {
      await c.close(true);
    } catch (closeErr: any) {
      console.log('Error closing MongoClient after failed connect - Error name:', closeErr && closeErr.name, 'Error message:', closeErr && closeErr.message);
    }
    client = undefined;
    throw err;
  }

  app.use((req: any, res: any, next: any) => {
    if (req.is && req.is('application/ejson')) {
      try {
        req.body = EJSON.parse(req.body);
      } catch (err: any) {
        return sendResponse(req, res, { ok: false, error: 'Invalid EJSON body' }, 400);
      }
    }
    next();
  });

  if (shouldLog('debug')) {
    app.use((req: any, res: any, next: any) => {
      const started = Date.now();
      res.on('finish', () => {
        const isGate = (req.originalUrl || req.url || '').includes('/revlm-gate');
        if (isGate) return;
        const locals = (res as any).locals || {};
        const body = locals.revlmResponse ? locals.revlmResponse.body : undefined;
        const ok = body && typeof body === 'object' ? (body as any).ok : undefined;
        const reason = body && typeof body === 'object' ? ((body as any).reason || (body as any).error) : undefined;
        const code = body && typeof body === 'object' ? (body as any).code : undefined;
        const detail = body && typeof body === 'object' ? (body as any).detail : undefined;
        console.log('requestLog', {
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          ok,
          reason,
          code,
          detail,
          durationMs: Date.now() - started,
        });
      });
      next();
    });
  }

  if (PROVISIONAL_LOGIN_ENABLED) {
    app.post('/provisional-login', async (req: Request, res: Response) => {
      const { authId, password } = req.body;
      if (!authId || !password) return sendResponse(req, res, { ok: false, error: 'authId and password are required' }, 400);
      const authFailed = { ok: false, error: 'Authentication failed', code: ERROR_CODES.authFailed };
      try {
        if (authId !== PROVISIONAL_AUTH_ID) {
          return sendResponse(req, res, { ...authFailed, detail: 'provisional authId mismatch' }, 401);
        }
        const passwordValid = await plpaServer!.validatePassword(password);
        if (!passwordValid || !passwordValid.ok) {
          return sendResponse(req, res, { ...authFailed, detail: 'provisional password invalid' }, 401);
        }

        const token = jwt.sign({ userType: 'provisional' }, JWT_SECRET as string, { expiresIn: '5s' });
        try {
          const decoded = jwt.decode(token);
          if (shouldLog('debug')) {
            console.log('TOKEN PAYLOAD (provisional-login):', decoded);
          }
        } catch (e) {
          if (shouldLog('debug')) {
            console.log('Failed to decode provisional token payload', e);
          }
        }
        return sendResponse(req, res, { ok: true, token, user: {} });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return sendResponse(req, res, { ok: false, error: err.message, code: err.code ?? ERROR_CODES.authFailed, detail: err.stack }, statusCode);
      }
    });
  } else {
    if (shouldLog('debug')) {
      console.log('PROVISIONAL_LOGIN_ENABLED is false; /provisional-login route not registered');
    }
  }

  app.post('/login', async (req: Request, res: Response) => {
    const { authId, password } = req.body;
    if (!authId || !password) return sendResponse(req, res, { ok: false, error: 'authId and password are required' }, 400);
    try {
      // Require sessionId to create a session-scoped refresh secret.
      // セッション単位のrefresh secret作成のためsessionIdを必須にする。
      const sessionId = requireSessionId(req);
      if (!sessionId) {
        return sendResponse(req, res, { ok: false, reason: 'missing_session_id', code: ERROR_CODES.invalidToken }, 400);
      }
      const userCol = getClient().db(USERS_DB_NAME as string).collection(USERS_COLLECTION as string);
      const user = await userCol.findOne({ authId });
      if (!user || !user.passwordHash) return sendResponse(req, res, { ok: false, error: 'Authentication failed', code: ERROR_CODES.authFailed }, 401);
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return sendResponse(req, res, { ok: false, error: 'Authentication failed', code: ERROR_CODES.authFailed }, 401);
      const { _id, userType, roles } = user;
      const token = jwt.sign({ _id, userType, roles }, JWT_SECRET as string, { expiresIn: JWT_EXPIRES_IN as number });
      const refreshSecret = await issueRefreshSecret(_id, sessionId);
      setRefreshCookie(res, refreshSecret.signed);
      try {
        const decoded = jwt.decode(token);
        console.log('TOKEN PAYLOAD (login):', decoded);
      } catch (e) {
        console.log('Failed to decode login token payload', e);
      }
      return sendResponse(req, res, { ok: true, token, user });
    } catch (err: any) {
      scheduleMongoFatalExit('POST /login', err);
      const statusCode = err.statusCode || 500;
      return sendResponse(req, res, { ok: false, error: err.message }, statusCode);
    }
  });

  app.post('/registerUser', verifyToken, async (req: Request, res: Response) => {
    const { user, password } = req.body;
    try {
      const newUser = await registerUserRaw(user, password);
      return sendResponse(req, res, { ok: true, user: newUser });
    } catch (err: any) {
      scheduleMongoFatalExit('POST /registerUser', err);
      return sendResponse(req, res, { ok: false, error: err.message }, 400);
    }
  });

  app.post('/deleteUser', verifyToken, async (req: Request, res: Response) => {
    if ((req as any).user && (req as any).user.userType === 'provisional') {
      return sendResponse(req, res, { ok: false, error: 'provisional user cannot delete users' }, 403);
    }
    const { _id, authId } = req.body as { _id?: any; authId?: string };
    try {
      const deletedCount = await deleteUserRaw(_id, authId);
      return sendResponse(req, res, { ok: true, deletedCount });
    } catch (err: any) {
      scheduleMongoFatalExit('POST /deleteUser', err);
      return sendResponse(req, res, { ok: false, error: err.message }, 400);
    }
  });

  app.post('/revlm-gate', verifyToken, async (req: Request, res: Response) => {
    const { db, collection, method, document, options, filter, update, replacement, pipeline, documents } = req.body as any;
    try {
      const _db = getClient().db(db);
      if (!_db) return sendResponse(req, res, { ok: false, error: 'Invalid db parameter' }, 400);

      // Block writes to refresh session storage from gate.
      // refresh session用コレクションへの書き込みを禁止する。
      if (collection === REFRESH_SESSIONS_COLLECTION) {
        const writeMethods = new Set([
          'insertOne',
          'insertMany',
          'updateOne',
          'updateMany',
          'replaceOne',
          'findOneAndUpdate',
          'findOneAndReplace',
          'deleteOne',
          'deleteMany',
          'drop',
        ]);
        if (writeMethods.has(method)) {
          return sendResponse(req, res, { ok: false, error: 'forbidden_collection' }, 403);
        }
      }

      const col = _db.collection(collection);
      if (!col) return sendResponse(req, res, { ok: false, error: 'Invalid collection parameter' }, 400);

      let result;
      switch (method) {
        case 'find':
          result = await col.find(filter || {}, options || {}).toArray();
          break;
        case 'findOne':
          result = await col.findOne(filter || {}, options || {});
          break;
        case 'findOneAndUpdate':
          result = await col.findOneAndUpdate(filter, update, options || {});
          break;
        case 'findOneAndReplace':
          result = await col.findOneAndReplace(filter, replacement, options || {});
          break;
        case 'findOneAndDelete':
          result = await col.findOneAndDelete(filter || {}, options || {});
          break;
        case 'aggregate':
          result = await col.aggregate(pipeline).toArray();
          break;
        case 'count':
          result = await col.countDocuments(filter || {}, options || {});
          break;
        case 'insertOne':
          result = await col.insertOne(document);
          break;
        case 'insertMany':
          result = await col.insertMany(documents);
          break;
        case 'deleteOne':
          result = await col.deleteOne(filter || {});
          break;
        case 'deleteMany':
          result = await col.deleteMany(filter || {});
          break;
        case 'updateOne':
          result = await col.updateOne(filter, update, options || {});
          break;
        case 'updateMany':
          result = await col.updateMany(filter, update, options || {});
          break;
        case 'watch':
          const changeStream = col.watch(options || {});
          result = [];
          for await (const change of changeStream) {
            result.push(change);
          }
          break;
        case 'drop':
          result = await col.drop();
          break;
        default:
          return sendResponse(req, res, { ok: false, error: 'Unsupported method' }, 400);
      }
      return sendResponse(req, res, { ok: true, result });
    } catch (err: any) {
      scheduleMongoFatalExit('POST /revlm-gate', err);
      const statusCode = err.statusCode || 500;
      return sendResponse(req, res, { ok: false, error: err.message }, statusCode);
    }
  });

  try {
    server = app.listen(port);
  } catch (err: any) {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`Port ${port} already in use (sync), assuming server is started elsewhere`);
      server = undefined;
      return server;
    }
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      console.log(`🚀 Revlm API server started on port ${port}`);
      resolve();
    });
    server.once('error', (err: any) => {
      if (err && err.code === 'EADDRINUSE') {
        console.log(`Port ${port} already in use, assuming server is started elsewhere`);
        server = undefined;
        resolve();
      } else {
        reject(err);
      }
    });
  });
  return server;
}

export async function stopServer() {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  }
  if (client) {
    await client.close(true);
  }
}
