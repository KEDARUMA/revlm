/*
Integration test: auto refresh on 401 with real server + in-memory MongoDB.
This uses a simple Cookie jar for Node fetch to persist revlm_refresh.
*/
import dotenv from 'dotenv';
import path from 'path';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createTestUser,
  cleanupTestUser,
  SetupTestEnvironmentResult,
} from '@kedaruma/revlm-server/__tests__/setupTestMongo';
import Revlm from '../Revlm';

dotenv.config({ path: path.join(__dirname, 'test.env') });

jest.setTimeout(20000);

const TEST_AUTH_ID = `auth-refresh-${Date.now()}`;
const TEST_PASSWORD = 'auth-refresh-pass';
const SESSION_ID = 'test-session';

function createFetchWithCookies(baseFetch: typeof fetch) {
  const cookieJar = { value: '' };
  return async (input: any, init: RequestInit = {}) => {
    // Preserve refresh cookie across requests for Node fetch.
    // Node fetch のリクエスト間で refresh cookie を保持する。
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const baseHeaders = isRequest ? input.headers : undefined;
    const headers = new Headers(init.headers || baseHeaders || {});
    if (cookieJar.value) headers.set('cookie', cookieJar.value);
    const request = isRequest
      ? new Request(input, { headers })
      : new Request(input, { ...init, headers });
    const res = await baseFetch(request);
    const setCookie = (res.headers as any).getSetCookie?.() ?? res.headers.get('set-cookie');
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (cookieValue) cookieJar.value = cookieValue.split(';')[0];
    return res;
  };
}

describe('Revlm autoRefreshOn401 (integration)', () => {
  let testEnv: SetupTestEnvironmentResult;

  beforeAll(async () => {
    // Spin up in-memory MongoDB and server for integration.
    // 統合テスト用にインメモリMongoDBとサーバを起動する。
    testEnv = await setupTestEnvironment({
      serverConfig: {
        mongoUri: process.env.MONGO_URI as string,
        usersDbName: ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required'),
        usersCollectionName: ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required'),
        jwtSecret: ensureDefined(process.env.JWT_SECRET, 'JWT_SECRET is required'),
        jwtExpiresIn: 1,
        refreshWindowSec: 10,
        provisionalLoginEnabled: true,
        provisionalAuthId: ensureDefined(process.env.PROVISIONAL_AUTH_ID, 'PROVISIONAL_AUTH_ID is required'),
        provisionalAuthSecretMaster: ensureDefined(process.env.PROVISIONAL_AUTH_SECRET_MASTER, 'PROVISIONAL_AUTH_SECRET_MASTER is required'),
        provisionalAuthDomain: ensureDefined(process.env.PROVISIONAL_AUTH_DOMAIN, 'PROVISIONAL_AUTH_DOMAIN is required'),
        refreshSecretSigningKey: process.env.REFRESH_SECRET_SIGNING_KEY || 'test-refresh-signing',
        port: 0,
      },
    });

    // Create a test user via provisional login and register.
    // provisional login と register でテストユーザを作成する。
    await createTestUser({
      serverUrl: testEnv.serverUrl,
      user: { authId: TEST_AUTH_ID, userType: 'user', roles: [] },
      password: TEST_PASSWORD,
      provisionalAuthId: ensureDefined(process.env.PROVISIONAL_AUTH_ID, 'PROVISIONAL_AUTH_ID is required'),
      provisionalAuthSecretMaster: ensureDefined(process.env.PROVISIONAL_AUTH_SECRET_MASTER, 'PROVISIONAL_AUTH_SECRET_MASTER is required'),
      provisionalAuthDomain: ensureDefined(process.env.PROVISIONAL_AUTH_DOMAIN, 'PROVISIONAL_AUTH_DOMAIN is required'),
    });
  });

  afterAll(async () => {
    await cleanupTestUser(TEST_AUTH_ID);
    await cleanupTestEnvironment(testEnv);
  });

  it('refreshes token after expiry and retries the request', async () => {
    if (typeof fetch === 'undefined') {
      throw new Error('global fetch is required for this test');
    }
    // Use cookie-aware fetch so refresh-token can succeed in Node.
    // Node で refresh-token が通るよう Cookie 対応 fetch を使う。
    const client = new Revlm(testEnv.serverUrl, {
      fetchImpl: createFetchWithCookies(fetch),
      autoRefreshOn401: true,
      sessionId: SESSION_ID,
    });

    const loginRes = await client.login(TEST_AUTH_ID, TEST_PASSWORD);
    expect(loginRes.ok).toBe(true);
    const initialToken = client.getToken();
    expect(initialToken).toBeTruthy();

    // Wait for the short-lived JWT to expire.
    // 短命JWTの期限切れを待つ。
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const res = await client.revlmGate({
      db: ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required'),
      collection: ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required'),
      method: 'find',
      filter: { authId: TEST_AUTH_ID },
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(client.getToken()).not.toBe(initialToken);
  });
});
