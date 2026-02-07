// Jest test file for testing token verification and refresh functionality
// - Test /verify-token endpoint with valid, expired, and malformed tokens
// - Test /refresh-token endpoint with various token states
// - Verify token expiration and refresh window behavior
// JWTトークンの検証とリフレッシュ機能をテストする Jest テストファイル
// - 有効・期限切れ・不正なトークンで /verify-token エンドポイントをテスト
// - 様々なトークン状態で /refresh-token エンドポイントをテスト
// - トークンの有効期限とリフレッシュウィンドウの動作を検証

import request from 'supertest';
import { EJSON } from 'bson';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { SetupTestEnvironmentResult, setupTestEnvironment, cleanupTestEnvironment } from './setupTestMongo';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import path from 'path';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcrypt';

const filenameUrl = fileURLToPath(import.meta.url);
const __dirname = path.dirname(filenameUrl);

// Load environment variables (refer to .env) so that the necessary settings for the test are stored in process.env.
// 環境変数を読み込む（.env を参照）テスト内で必要な設定が process.env に入る。
dotenv.config({ path: path.join(__dirname, 'test.env') });

// Extend Jest hook timeout to allow mongodb-memory-server to download/start
// Jest フックのタイムアウトを延長して mongodb-memory-server のダウンロード/起動を許可する
jest.setTimeout(120000);

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const REFRESH_WINDOW_SEC = Number(process.env.REFRESH_WINDOW_SEC ?? '300');

let testEnv: SetupTestEnvironmentResult;
let SERVER_URL: string;
let mongoClient: MongoClient;
let staffUserDoc: any;
let provUserDoc: any;

const STAFF_USER = { authId: 'token_user', password: 'tokenpass', userType: 'staff' as const, roles: ['a'] };
const PROV_USER = { authId: 'prov_token_user', password: 'provpass', userType: 'provisional' as const, roles: ['p'] };
const SESSION_ID = 'test-session';

async function upsertUser(user: typeof STAFF_USER | typeof PROV_USER) {
  const col = mongoClient
    .db(ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required'))
    .collection(ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required'));
  const hash = await bcrypt.hash(user.password, 10);
  await col.updateOne(
    { authId: user.authId },
    { $set: { authId: user.authId, passwordHash: hash, userType: user.userType, roles: user.roles } },
    { upsert: true }
  );
  return await col.findOne({ authId: user.authId });
}

async function loginAndGetCookie(authId: string, password: string, sessionId = SESSION_ID) {
  const res = await request(SERVER_URL)
    .post('/login')
    .set('x-revlm-session-id', sessionId)
    .send({ authId, password });
  const body = parseBody(res);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] || []);
  const cookie = cookies.find((c: string) => c.startsWith('revlm_refresh'));
  return { token: body?.token, cookie };
}

function extractCookieValue(cookie?: string): string | undefined {
  // Extract refresh cookie raw value from Set-Cookie.
  // Set-CookieからリフレッシュCookieの値のみ抽出する。
  if (!cookie) return undefined;
  const first = cookie.split(';')[0];
  const eq = first.indexOf('=');
  if (eq === -1) return undefined;
  return first.slice(eq + 1);
}

async function signedPost(pathname: string, body: any, token?: string, sessionId = SESSION_ID) {
  const req = request(SERVER_URL).post(pathname);
  if (token) req.set('X-Revlm-JWT', `Bearer ${token}`);
  if (sessionId) req.set('x-revlm-session-id', sessionId);
  return req.send(body);
}

function parseBody(res: request.Response): any {
  if (res && res.body && typeof res.body === 'object' && Object.keys(res.body).length) {
    return res.body;
  }
  if (res && typeof res.text === 'string' && res.text.length) {
    try {
      return EJSON.parse(res.text);
    } catch {
      return res.text;
    }
  }
  return res?.body;
}

beforeAll(async () => {
  console.log('beforeAll: start');

  // Setup test environment (MongoDB + Server) using the utility function
  // ユーティリティ関数を使用してテスト環境（MongoDB + サーバー）をセットアップ
  testEnv = await setupTestEnvironment({
    serverConfig: {
      mongoUri: process.env.MONGO_URI as string,
      usersDbName: ensureDefined(process.env.USERS_DB_NAME || 'testdb', 'USERS_DB_NAME is required'),
      usersCollectionName: ensureDefined(process.env.USERS_COLLECTION_NAME || 'users', 'USERS_COLLECTION_NAME is required'),
      jwtSecret: JWT_SECRET,
      provisionalLoginEnabled: false,
      refreshSecretSigningKey: ensureDefined(process.env.REFRESH_SECRET_SIGNING_KEY, 'REFRESH_SECRET_SIGNING_KEY is required'),
      port: Number(process.env.PORT),
    }
  });

  SERVER_URL = testEnv.serverUrl;
  mongoClient = new MongoClient(testEnv.uri);
  await mongoClient.connect();
  staffUserDoc = await upsertUser(STAFF_USER);
  provUserDoc = await upsertUser(PROV_USER);
  console.log('beforeAll: server started at', SERVER_URL);
  console.log('beforeAll: end');
});

afterAll(async () => {
  console.log('afterAll: start');

  // Clean up test environment (stop server and MongoDB) using the utility function
  // ユーティリティ関数を使用してテスト環境をクリーンアップ（サーバーと MongoDB を停止）
  await cleanupTestEnvironment(testEnv);
  if (mongoClient) {
    await mongoClient.close();
  }

  console.log('afterAll: done');
});

describe('/verify-token', () => {
  // 有効なトークンに対してペイロードを返す
  it('returns payload for valid token', async () => {
    const token = jwt.sign({ foo: 'bar' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await signedPost('/verify-token', {}, token);
    const body = parseBody(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.payload).toBeDefined();
    expect(body.payload.foo).toBe('bar');
  });

  // 期限切れトークンに対して token_expired を返す
  it('returns token_expired for expired token', async () => {
    const payload = { foo: 'baz', exp: Math.floor(Date.now() / 1000) - 10 };
    const token = jwt.sign(payload as any, JWT_SECRET);
    const res = await signedPost('/verify-token', {}, token);
    const body = parseBody(res);
    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('token_expired');
  });

  // 不正なトークンに対して invalid_token を返す
  it('returns invalid_token for malformed token', async () => {
    const res = await signedPost('/verify-token', {}, 'invalid.token.here');
    const body = parseBody(res);
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('invalid_token');
  });
});

describe('/refresh-token', () => {
  async function refresh(token: string, cookie?: string, serverUrl = SERVER_URL, sessionId = SESSION_ID) {
    const req = request(serverUrl)
      .post('/refresh-token')
      .set('X-Revlm-JWT', `Bearer ${token}`);
    if (sessionId) req.set('x-revlm-session-id', sessionId);
    if (cookie) req.set('Cookie', [cookie]);
    return req.send({});
  }

  async function refreshWithHeader(token: string, refreshHeader?: string, serverUrl = SERVER_URL, sessionId = SESSION_ID) {
    const req = request(serverUrl)
      .post('/refresh-token')
      .set('X-Revlm-JWT', `Bearer ${token}`);
    if (sessionId) req.set('x-revlm-session-id', sessionId);
    if (refreshHeader) req.set('x-revlm-refresh', refreshHeader);
    return req.send({});
  }

  it('refreshes an expired non-provisional token within window', async () => {
    const { cookie } = await loginAndGetCookie(STAFF_USER.authId, STAFF_USER.password);
    const expired = jwt.sign(
      { _id: staffUserDoc._id, userType: staffUserDoc.userType, roles: staffUserDoc.roles, exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    );
    const res = await refresh(expired, cookie);
    const body = parseBody(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeDefined();
    const verify = await signedPost('/verify-token', {}, body.token);
    const verifyBody = parseBody(verify);
    expect(verify.status).toBe(200);
    expect(verifyBody.ok).toBe(true);
  });

  it('refreshes using header when cookie header is absent', async () => {
    const { cookie } = await loginAndGetCookie(STAFF_USER.authId, STAFF_USER.password);
    const refreshHeader = extractCookieValue(cookie);
    const expired = jwt.sign(
      { _id: staffUserDoc._id, userType: staffUserDoc.userType, roles: staffUserDoc.roles, exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    );
    const res = await refreshWithHeader(expired, refreshHeader);
    const body = parseBody(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeDefined();
  });

  it('rejects refresh when token is not expired', async () => {
    const { token, cookie } = await loginAndGetCookie(STAFF_USER.authId, STAFF_USER.password);
    const res = await refresh(token, cookie);
    const body = parseBody(res);
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not_expired');
  });

  it('rejects provisional tokens even if expired', async () => {
    const { cookie } = await loginAndGetCookie(PROV_USER.authId, PROV_USER.password);
    const expired = jwt.sign(
      { _id: provUserDoc._id, userType: 'provisional', roles: provUserDoc.roles, exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    );
    const res = await refresh(expired, cookie);
    const body = parseBody(res);
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('provisional_forbidden');
  });

  it('rejects refresh beyond grace window', async () => {
    const { cookie } = await loginAndGetCookie(STAFF_USER.authId, STAFF_USER.password);
    const old = Math.floor(Date.now() / 1000) - (REFRESH_WINDOW_SEC + 10);
    const expired = jwt.sign(
      { _id: staffUserDoc._id, userType: staffUserDoc.userType, roles: staffUserDoc.roles, exp: old },
      JWT_SECRET
    );
    const res = await refresh(expired, cookie);
    const body = parseBody(res);
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('refresh_window_exceeded');
  });

  it('rejects refresh when sessionId mismatches', async () => {
    const { cookie } = await loginAndGetCookie(STAFF_USER.authId, STAFF_USER.password, 'sess-a');
    const expired = jwt.sign(
      { _id: staffUserDoc._id, userType: staffUserDoc.userType, roles: staffUserDoc.roles, exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    );
    const res = await refresh(expired, cookie, SERVER_URL, 'sess-b');
    const body = parseBody(res);
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('refresh_secret_mismatch');
  });
});

// refresh with unlimited window still succeeds for long-expired tokens (refreshWindowSec=0)
// refreshWindowSec=0（無制限）のときに大幅に期限切れたトークンでもリフレッシュできることを検証する
describe('/refresh-token with unlimited window', () => {
  let testEnvUnlimited: SetupTestEnvironmentResult;
  let serverUrlUnlimited: string;
  let mongoUnlimited: MongoClient;
  let unlimitedUserDoc: any;

  beforeAll(async () => {
    testEnvUnlimited = await setupTestEnvironment({
      serverConfig: {
        mongoUri: process.env.MONGO_URI as string,
        usersDbName: ensureDefined(process.env.USERS_DB_NAME || 'testdb', 'USERS_DB_NAME is required'),
        usersCollectionName: ensureDefined(process.env.USERS_COLLECTION_NAME || 'users', 'USERS_COLLECTION_NAME is required'),
        jwtSecret: JWT_SECRET,
        provisionalLoginEnabled: false,
        refreshWindowSec: 0,
        refreshSecretSigningKey: ensureDefined(process.env.REFRESH_SECRET_SIGNING_KEY, 'REFRESH_SECRET_SIGNING_KEY is required'),
        port: Number(process.env.PORT),
      }
    });
    serverUrlUnlimited = testEnvUnlimited.serverUrl;
    mongoUnlimited = new MongoClient(testEnvUnlimited.uri);
    await mongoUnlimited.connect();
    const col = mongoUnlimited
      .db(ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required'))
      .collection(ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required'));
    const hash = await bcrypt.hash('unlimited-pass', 10);
    await col.updateOne(
      { authId: 'unlimited-user' },
      { $set: { authId: 'unlimited-user', passwordHash: hash, userType: 'staff', roles: ['u'] } },
      { upsert: true }
    );
    unlimitedUserDoc = await col.findOne({ authId: 'unlimited-user' });
  });

  afterAll(async () => {
    await cleanupTestEnvironment(testEnvUnlimited);
    if (mongoUnlimited) {
      await mongoUnlimited.close();
    }
  });

  it('refreshes even long-expired token when window is unlimited', async () => {
    const loginRes = await request(serverUrlUnlimited)
      .post('/login')
      .set('x-revlm-session-id', SESSION_ID)
      .send({ authId: 'unlimited-user', password: 'unlimited-pass' });
    const rawSetCookie = loginRes.headers['set-cookie'] || [];
    const cookies = ([] as string[]).concat(rawSetCookie as any);
    const cookieFull = cookies.find((c: string) => c.startsWith('revlm_refresh'));
    const refreshCookie = cookieFull ? cookieFull.split(';')[0] : undefined;
    const expiredPayload = { _id: unlimitedUserDoc._id, userType: 'staff', roles: ['u'], exp: Math.floor(Date.now() / 1000) - 60 * 60 * 24 };
    const token = jwt.sign(expiredPayload as any, JWT_SECRET);
    const res = await request(serverUrlUnlimited)
      .post('/refresh-token')
      .set('X-Revlm-JWT', `Bearer ${token}`)
      .set('x-revlm-session-id', SESSION_ID)
      .set('Cookie', refreshCookie ? [refreshCookie] : [])
      .send({});
    const body = parseBody(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeDefined();
  });
});
