/*
Test overview: An integration test covering the flow from provisionalLogin through register → login → delete.
Start revlm-server and validate by calling real HTTP endpoints from the client.
Confirm verifyToken succeeds, refreshToken fails for a provisional token, and the provisional token expires as expected.
Settings are loaded from tests/test.env.
テスト概要: provisionalLogin を起点に、登録→ログイン→削除までの一連を統合テスト。
revlm-server を立ち上げ、client で実エンドポイントを叩いて検証。
verifyToken で有効を確認、仮アカウントのトークン refreshToken が失敗する事を確認、仮アカウントのトークン期限切れ確認。
設定は __tests__/test.env を使用。
*/

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  SetupTestEnvironmentResult,
  createTestUser,
  cleanupTestUser
} from '@kedaruma/revlm-server/__tests__/setupTestMongo';
import Revlm, { App, Credentials } from '../Revlm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_USER_ID = 'test'
const TEST_USER_PASSWORD = 'test'

dotenv.config({ path: path.join(__dirname, 'test.env') });

let testEnv: SetupTestEnvironmentResult;

jest.setTimeout(20000);
const SESSION_ID = 'test-session';

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

// provisionalLogin の結合テスト
describe('Revlm.provisionalLogin (integration)', () => {
  // Shared client and provisional token for tests
  let revlm: Revlm;
  let provisionalToken: string | undefined;

  beforeAll(async () => {
    // テスト環境をセットアップ (MongoDB + サーバー)
    // Setup test environment (MongoDB + Server)
    testEnv = await setupTestEnvironment({
      serverConfig: {
        mongoUri: process.env.MONGO_URI as string,
        usersDbName: process.env.USERS_DB_NAME as string,
        usersCollectionName: process.env.USERS_COLLECTION_NAME as string,
        jwtSecret: process.env.JWT_SECRET as string,
        provisionalLoginEnabled: true,
        provisionalAuthId: process.env.PROVISIONAL_AUTH_ID as string,
        provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
        provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
        refreshSecretSigningKey: process.env.REFRESH_SECRET_SIGNING_KEY as string,
        port: Number(process.env.PORT),
      }
    });

    // create client and perform provisional login once for reuse
    revlm = new Revlm(testEnv.serverUrl,
      {
        provisionalEnabled: true,
        provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
        provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
        fetchImpl: createFetchWithCookies(fetch),
        sessionId: SESSION_ID,
      }
    );
    const res = await revlm.provisionalLogin(process.env.PROVISIONAL_AUTH_ID as string);
    if (!res.ok || !res.token) throw new Error('Failed to obtain provisional token in beforeAll: ' + JSON.stringify(res));
    provisionalToken = res.token as string;

    await createTestUser({
      serverUrl: testEnv.serverUrl,
      user: { authId: TEST_USER_ID, userType: 'user', roles: [] },
      password: TEST_USER_PASSWORD,
      provisionalAuthId: process.env.PROVISIONAL_AUTH_ID as string,
      provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
      provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
    });
  });

  afterAll(async () => {
    await cleanupTestUser(TEST_USER_ID);
    await cleanupTestEnvironment(testEnv);
  });

  it('emulates Realm.App login/currentUser/allUsers and MongoDB service', async () => {
    const app = new App(testEnv.serverUrl, { fetchImpl: createFetchWithCookies(fetch), sessionId: SESSION_ID });
    const creds = Credentials.emailPassword(TEST_USER_ID, TEST_USER_PASSWORD);
    const user = await app.logIn(creds);

    expect(app.currentUser).toBe(user);
    expect(Object.keys(app.allUsers).length).toBe(1);

    // mongoClient → db → collection path should function and find the created user
    const coll = user.mongoClient().db(process.env.USERS_DB_NAME as string).collection(process.env.USERS_COLLECTION_NAME as string);
    const found = await coll.findOne({ authId: TEST_USER_ID });
    expect(found).toBeTruthy();
    expect((found as any).authId).toBe(TEST_USER_ID);

    // emailPasswordAuth.registerUser/deleteUser wrappers should work
    const tempUser = `temp-${Date.now()}`;
    const regRes = await app.emailPasswordAuth.registerUser(tempUser, 'pw');
    expect(regRes.ok).toBe(true);
    const delRes = await app.emailPasswordAuth.deleteUser(tempUser);
    expect(delRes.ok).toBe(true);

    // user.functions stub should throw not implemented
    await expect(user.functions.callFunction('dummy')).rejects.toThrow();

    // removeUser should clear currentUser and registry
    await app.removeUser(user);
    expect(app.currentUser).toBeNull();
    expect(Object.keys(app.allUsers).length).toBe(0);

    // switchUser should set currentUser and token when multiple users are stored
    const userA = await app.logIn(Credentials.emailPassword(TEST_USER_ID, TEST_USER_PASSWORD));
    const userB = await app.logIn(Credentials.emailPassword(TEST_USER_ID, TEST_USER_PASSWORD));
    expect(app.currentUser).toBe(userB);
    app.switchUser(userA);
    expect(app.currentUser).toBe(userA);
  });
});
