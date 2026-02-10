import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { ObjectId } from 'bson';
import Revlm from '../Revlm';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  SetupTestEnvironmentResult,
  createTestUser,
  cleanupTestUser,
} from '@kedaruma/revlm-server/__tests__/setupTestMongo';
import { pruneExpiredRefreshSessions } from '@kedaruma/revlm-server/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, 'test.env') });

jest.setTimeout(20000);

const SHORT_TTL_SEC = 2;
// Use Node crypto for AuthClient.
// AuthClient 用に Node crypto を使う。

function createFetchWithCookies(baseFetch: typeof fetch) {
  const cookieJar = { value: '' };
  return async (input: any, init: RequestInit = {}) => {
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

describe('Revlm zombie session pruning', () => {
  it('refresh-token fails once session TTL is exceeded and prune has run', async () => {
    const testEnv = await setupTestEnvironment({
      serverConfig: {
        mongoUri: process.env.MONGO_URI as string,
        usersDbName: process.env.USERS_DB_NAME as string,
        usersCollectionName: process.env.USERS_COLLECTION_NAME as string,
        jwtSecret: process.env.JWT_SECRET as string,
        jwtExpiresIn: 1,
        refreshWindowSec: 10,
        provisionalLoginEnabled: true,
        provisionalAuthId: process.env.PROVISIONAL_AUTH_ID as string,
        provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
        provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
        refreshSecretSigningKey: process.env.REFRESH_SECRET_SIGNING_KEY as string,
        refreshSessionTtlSec: SHORT_TTL_SEC,
        port: 0,
      },
    });
    const sessionId = 'zombie-session';
    const authId = `zombie-user-${Date.now()}`;
    const password = 'zombie-pass-' + Math.random().toString(36).slice(2, 8);
    const user = {
      _id: new ObjectId(),
      authId,
      userType: 'user',
      roles: [] as string[],
    };
    try {
      await createTestUser({
        serverUrl: testEnv.serverUrl,
        user,
        password,
        provisionalAuthId: process.env.PROVISIONAL_AUTH_ID as string,
        provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
        provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
      });
      const client = new Revlm(testEnv.serverUrl, {
        fetchImpl: createFetchWithCookies(fetch),
        sessionId,
      });
      const loginRes = await client.login(authId, password);
      expect(loginRes.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, (SHORT_TTL_SEC + 1) * 1000));
      await pruneExpiredRefreshSessions();
      const refreshRes = await client.refreshToken();
      expect(refreshRes.ok).toBe(false);
      const reason = (refreshRes as any).reason || (refreshRes as any).error;
      expect(['refresh_secret_invalid', 'refresh_secret_mismatch', 'refresh_window_exceeded']).toContain(reason);
      const relogin = await client.login(authId, password);
      expect(relogin.ok).toBe(true);
    } finally {
      await cleanupTestUser(authId);
      await cleanupTestEnvironment(testEnv);
    }
  });
});
