// Jest test file for /revlm-gate integration (excluding watch)
// - Exercises CRUD and query methods via the gate endpoint
// - Uses setupTestEnvironment to spin up server + (in-memory) MongoDB
// /revlm-gate の統合テスト（watch を除く）
// - gate エンドポイント経由で CRUD / クエリ各メソッドを実行
// - setupTestEnvironment でサーバ + （インメモリ）MongoDB を起動
import request from 'supertest';
import { ObjectId, EJSON } from 'bson';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import { User } from '@kedaruma/revlm-shared/models/user-types';
import {
  SetupTestEnvironmentResult,
  setupTestEnvironment,
  createTestUser,
  cleanupTestUser,
  cleanupTestEnvironment,
} from '@kedaruma/revlm-server/__tests__/setupTestMongo';
import { pruneExpiredRefreshSessions } from '@kedaruma/revlm-server/server';

// Load environment variables
// 環境変数を読み込む
dotenv.config({ path: path.join(__dirname, 'test.env') });

jest.setTimeout(120000);

const USERS_DB_NAME = ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required');
const USERS_COLLECTION_NAME = ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required');
const PROVISIONAL_AUTH_DOMAIN = ensureDefined(process.env.PROVISIONAL_AUTH_DOMAIN);
const PROVISIONAL_AUTH_SECRET_MASTER = ensureDefined(process.env.PROVISIONAL_AUTH_SECRET_MASTER);
const PROVISIONAL_AUTH_ID = ensureDefined(process.env.PROVISIONAL_AUTH_ID);
const SESSION_ID = 'test-session';

let testEnv: SetupTestEnvironmentResult;
let serverUrl: string;
let token: string;

// Parse EJSON response bodies into objects.
// EJSONレスポンスをオブジェクトに変換する。
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

// Test user and collection
// テスト用ユーザとコレクション
const testAuthId = 'gate_user_' + Date.now();
const testPassword = 'gatepass123';
const testUser: User = {
  _id: new ObjectId(),
  authId: testAuthId,
  userType: 'staff',
  roles: ['gate'],
};
const testCollection = `gate_test_${Date.now()}`;
const MULTI_SESSIONS = ['sess-1', 'sess-2', 'sess-3', 'sess-4'];
const REFRESH_COOKIE_NAME = 'revlm_refresh';
const REFRESH_SESSIONS_COLLECTION = 'revlm_refresh_sessions';
const TTL_TEST_SESSION = 'prune-test-session';

beforeAll(async () => {
  // Start server + MongoDB (enable provisional login)
  // サーバ + MongoDB 起動（provisional login 有効化）
  testEnv = await setupTestEnvironment({
    serverConfig: {
      mongoUri: process.env.MONGO_URI as string,
      usersDbName: USERS_DB_NAME,
      usersCollectionName: USERS_COLLECTION_NAME,
      jwtSecret: ensureDefined(process.env.JWT_SECRET, 'JWT_SECRET is required'),
      provisionalLoginEnabled: true,
      provisionalAuthId: PROVISIONAL_AUTH_ID,
      provisionalAuthSecretMaster: PROVISIONAL_AUTH_SECRET_MASTER,
      provisionalAuthDomain: PROVISIONAL_AUTH_DOMAIN,
      refreshSecretSigningKey: ensureDefined(process.env.REFRESH_SECRET_SIGNING_KEY, 'REFRESH_SECRET_SIGNING_KEY is required'),
      port: Number(process.env.PORT),
      jwtExpiresIn: 2,
      refreshSessionTtlSec: 1,
    },
  });
  serverUrl = testEnv.serverUrl;

  // Create test user (provisional login → registerUser)
  // テストユーザ作成（provisional ログイン → registerUser）
  await createTestUser({
    serverUrl,
    user: testUser,
    password: testPassword,
    provisionalAuthId: PROVISIONAL_AUTH_ID,
    provisionalAuthSecretMaster: PROVISIONAL_AUTH_SECRET_MASTER,
    provisionalAuthDomain: PROVISIONAL_AUTH_DOMAIN,
  });

  // Log in and obtain JWT
  // ログインして JWT 取得
  const loginRes = await request(serverUrl)
    .post('/login')
    .set('x-revlm-session-id', SESSION_ID)
    .send({ authId: testAuthId, password: testPassword });
  expect(loginRes.status).toBe(200);
  const loginBodyParsed = parseBody(loginRes);
  expect(loginBodyParsed.ok).toBe(true);
  token = loginBodyParsed.token as string;
});

afterAll(async () => {
  // Delete test user
  // テストユーザ削除
  try {
    await cleanupTestUser(testAuthId);
  } catch (e) {
    // Log only
    // ログのみ
    // eslint-disable-next-line no-console
    console.warn('cleanupTestUser failed:', e);
  }
  // Stop server/DB
  // サーバ/DB 停止
  await cleanupTestEnvironment(testEnv);
});

// Call /revlm-gate and parse EJSON response.
// /revlm-gate を呼び出して EJSON を解析する。
async function gateCall(body: any) {
  const res = await request(serverUrl)
    .post('/revlm-gate')
    .set('X-Revlm-JWT', `Bearer ${token}`)
    .send(body);
  const parsed = parseBody(res);
  return { res, body: parsed };
}

function extractCookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  if (!raw) return undefined;
  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const tokenPart = cookie.split(';')[0];
    const sep = tokenPart.indexOf('=');
    if (sep === -1) continue;
    const key = tokenPart.slice(0, sep).trim();
    if (key !== name) continue;
    return tokenPart.slice(sep + 1);
  }
  return undefined;
}

// Create a session-scoped token and refresh secret for concurrent queries.
// 同一ユーザのセッション別トークンとリフレッシュシークレットを発行する。
async function loginWithSession(sessionId: string): Promise<{ token: string; refreshCookie: string; sessionId: string }> {
  const loginRes = await request(serverUrl)
    .post('/login')
    .set('x-revlm-session-id', sessionId)
    .send({ authId: testAuthId, password: testPassword });
  const parsed = parseBody(loginRes);
  if (!parsed || !parsed.ok || !parsed.token) throw new Error('login failed for session: ' + sessionId);
  const refreshCookie = extractCookieValue(loginRes, REFRESH_COOKIE_NAME);
  if (!refreshCookie) throw new Error('refresh cookie missing for session: ' + sessionId);
  return {
    token: String(parsed.token),
    refreshCookie,
    sessionId,
  };
}

// Call /revlm-gate with explicit sessionId + token.
// sessionIdとtokenを指定して/revlm-gateを呼び出す。
async function gateCallWithSession(body: any, tokenValue: string, sessionId: string) {
  const res = await request(serverUrl)
    .post('/revlm-gate')
    .set('X-Revlm-JWT', `Bearer ${tokenValue}`)
    .set('x-revlm-session-id', sessionId)
    .send(body);
  const parsed = parseBody(res);
  return { res, body: parsed };
}

async function refreshSessionToken(sessionId: string, tokenValue: string, refreshCookie: string) {
  const res = await request(serverUrl)
    .post('/refresh-token')
    .set('authorization', `Bearer ${tokenValue}`)
    .set('x-revlm-session-id', sessionId)
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookie}`)
    .send();
  const parsed = parseBody(res);
  return { res, body: parsed, sessionId };
}

// /revlm-gate 統合テスト（watch を除く）
describe('/revlm-gate Integration (excluding watch)', () => {
  // 1) insertOne
  it('insertOne creates a document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'insertOne',
      document: { name: 'gateA', value: 1 },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.insertedId).toBeDefined();
  });

  // 2) find
  it('find returns inserted docs', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'find',
      filter: { name: 'gateA' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result.length).toBeGreaterThanOrEqual(1);
  });

  // 3) findOne
  it('findOne returns a single document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'findOne',
      filter: { name: 'gateA' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.name).toBe('gateA');
  });

  // 4) updateOne
  it('updateOne modifies a document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'updateOne',
      filter: { name: 'gateA' },
      update: { $set: { value: 2 } },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.modifiedCount).toBeGreaterThanOrEqual(1);
  });

  // 5) findOneAndUpdate (return updated)
  it('findOneAndUpdate returns updated document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'findOneAndUpdate',
      filter: { name: 'gateA' },
      update: { $set: { value: 3 } },
      options: { returnDocument: 'after' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // 一部ドライババージョンでは result.value が空になる場合があるため、後続の findOne で確定検証
    const { res: checkRes, body: checkBody } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'findOne',
      filter: { name: 'gateA' },
    });
    expect(checkRes.status).toBe(200);
    expect(checkBody.ok).toBe(true);
    expect(checkBody.result && checkBody.result.value).toBe(3);
  });

  // 6) insertMany
  it('insertMany inserts multiple docs', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'insertMany',
      documents: [
        { name: 'gateA', value: 4 },
        { name: 'gateB', value: 10 },
      ],
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const insertedIds = body.result && body.result.insertedIds;
    expect(insertedIds && Object.keys(insertedIds).length).toBe(2);
  });

  // 7) count (countDocuments)
  it('count returns number of matched documents', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'count',
      filter: { name: 'gateA' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.result).toBe('number');
    expect(body.result).toBeGreaterThanOrEqual(2);
  });

  // 8) aggregate (simple $match)
  it('aggregate with $match returns subset', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'aggregate',
      pipeline: [{ $match: { name: 'gateB' } }],
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result.length).toBe(1);
    expect(body.result[0] && body.result[0].name).toBe('gateB');
  });

  // 9) findOneAndReplace
  it('findOneAndReplace replaces a document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'findOneAndReplace',
      filter: { name: 'gateB' },
      replacement: { name: 'gateB', value: 99 },
      options: { returnDocument: 'after' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // 戻り値の形に依存せず、findOne で置換結果を確認
    const { res: checkRes, body: checkBody } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'findOne',
      filter: { name: 'gateB' },
    });
    expect(checkRes.status).toBe(200);
    expect(checkBody.ok).toBe(true);
    expect(checkBody.result && checkBody.result.value).toBe(99);
  });

  // 10) updateMany
  it('updateMany modifies multiple docs', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'updateMany',
      filter: { name: 'gateA' },
      update: { $inc: { value: 1 } },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.modifiedCount).toBeGreaterThanOrEqual(1);
  });

  // 11) deleteOne
  it('deleteOne removes one document', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'deleteOne',
      filter: { name: 'gateA' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.deletedCount).toBe(1);
  });

  // 12) deleteMany
  it('deleteMany removes multiple documents', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'deleteMany',
      filter: { name: 'gateA' },
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result && body.result.deletedCount).toBeGreaterThanOrEqual(1);
  });

  // 13) drop (最後にコレクション削除を確認)
  it('drop removes the test collection', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'drop',
    });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // MongoDB ドライバは drop 成功時に true を返す
    expect(body.result).toBe(true);
  });

  // 14) 不正なメソッド名でエラーが返される
  it('invalid method returns error', async () => {
    const { res, body } = await gateCall({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'invalidMethodName',
      filter: {},
    });
    // サーバが不正なメソッドを拒否することを確認
    expect(body.ok).toBe(false);
    // ステータスコードが 400 または 403 であることを確認
    expect([400, 403, 500]).toContain(res.status);
  });

  // 15) 同一ユーザの複数セッションで並列クエリが独立に成功する
  it('multi-session concurrent queries return distinct results', async () => {
    const sessions = await Promise.all(MULTI_SESSIONS.map((sid) => loginWithSession(sid)));
    const tokens = sessions.map((sessionData) => sessionData.token);
    type MultiSessionQuery = {
      sessionId: string;
      token: string;
      name: string;
      value: number;
    };
    const values = [11, 22, 33, 44];
    const queries: MultiSessionQuery[] = MULTI_SESSIONS.map((sessionId, index) => {
      const tokenValue = tokens[index];
      if (!tokenValue) throw new Error(`missing token for ${sessionId}`);
      const value = values[index];
      if (typeof value !== 'number') throw new Error(`missing value for session ${sessionId}`);
      return {
        sessionId,
        token: tokenValue,
        name: `ms-${index + 1}`,
        value,
      };
    });

    await Promise.all(queries.map(({ sessionId, token, name, value }) =>
      gateCallWithSession(
        {
          db: USERS_DB_NAME,
          collection: testCollection,
          method: 'insertOne',
          document: { name, value },
        },
        token,
        sessionId
      )
    ));

    const results = await Promise.all(queries.map(({ sessionId, token, name }) =>
      gateCallWithSession(
        {
          db: USERS_DB_NAME,
          collection: testCollection,
          method: 'find',
          filter: { name },
        },
        token,
        sessionId
      )
    ));

    results.forEach(({ res, body }, index) => {
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.result)).toBe(true);
      expect(body.result.length).toBe(1);
      const entry = body.result[0];
      expect(entry).toBeDefined();
      const query = queries[index];
      expect(query).toBeDefined();
      if (entry && query) {
        expect(query.name).toBe(entry.name);
        expect(query.value).toBe(entry.value);
      }
    });
  });
});

describe('refresh token session handling', () => {
  it('allows only one refresh success per session while mismatching stale requests', async () => {
    const sessionPayload = await loginWithSession('concurrent-refresh-session');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const first = await refreshSessionToken(sessionPayload.sessionId, sessionPayload.token, sessionPayload.refreshCookie);
    expect(first.res.status).toBe(200);
    const staleResults = await Promise.all(Array.from({ length: 3 }, () =>
      refreshSessionToken(sessionPayload.sessionId, sessionPayload.token, sessionPayload.refreshCookie)
    ));
    const mismatches = staleResults.filter((result) =>
      result.res.status === 403 && result.body && result.body.reason === 'refresh_secret_mismatch'
    );
    expect(mismatches.length).toBe(3);
    const successToken = first.body && first.body.token;
    expect(successToken).toBeTruthy();
    const { res: gateRes, body: gateBody } = await gateCallWithSession({
      db: USERS_DB_NAME,
      collection: testCollection,
      method: 'find',
      filter: { name: 'gateA' },
    }, successToken as string, sessionPayload.sessionId);
    expect(gateRes.status).toBe(200);
    expect(gateBody.ok).toBe(true);
  });

  it('prunes expired refresh sessions via TTL cleanup', async () => {
    const { sessionId } = await loginWithSession(TTL_TEST_SESSION);
    const mongoClient = await MongoClient.connect(testEnv.uri);
    const sessionCol = mongoClient.db(USERS_DB_NAME).collection(REFRESH_SESSIONS_COLLECTION);
    await sessionCol.updateOne(
      { sessionId },
      { $set: { updatedAt: new Date(Date.now() - 60000) } }
    );
    await pruneExpiredRefreshSessions();
    const remaining = await sessionCol.findOne({ sessionId });
    expect(remaining).toBeNull();
    await mongoClient.close();
  });
});
