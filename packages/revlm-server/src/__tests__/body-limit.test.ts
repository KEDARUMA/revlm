import request from 'supertest';
import { EJSON } from 'bson';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import { randomBytes as nodeRandomBytes } from 'crypto';
import path from 'path';
import { SetupTestEnvironmentResult, cleanupTestEnvironment, setupTestEnvironment } from './setupTestMongo';

const filenameUrl = fileURLToPath(import.meta.url);
const __dirname = path.dirname(filenameUrl);
const TEST_ENV_PATH = path.join(__dirname, 'test.env');

dotenv.config({ path: TEST_ENV_PATH });

jest.setTimeout(120000);

const USERS_DB_NAME = ensureDefined(process.env.USERS_DB_NAME, 'USERS_DB_NAME is required');
const USERS_COLLECTION_NAME = ensureDefined(process.env.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required');
const PROVISIONAL_AUTH_DOMAIN = ensureDefined(process.env.PROVISIONAL_AUTH_DOMAIN, 'PROVISIONAL_AUTH_DOMAIN is required');
const PROVISIONAL_AUTH_SECRET_MASTER = ensureDefined(process.env.PROVISIONAL_AUTH_SECRET_MASTER, 'PROVISIONAL_AUTH_SECRET_MASTER is required');
const PROVISIONAL_AUTH_ID = ensureDefined(process.env.PROVISIONAL_AUTH_ID, 'PROVISIONAL_AUTH_ID is required');
const LARGE_BLOB = 'x'.repeat(1280 * 1024);

let testEnv: SetupTestEnvironmentResult | undefined;

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

function makeLargeRegisterPayload(authId: string) {
  return {
    user: {
      authId,
      userType: 'staff',
      roles: ['body-limit'],
      largeBlob: LARGE_BLOB,
    },
    password: 'body-limit-pass',
  };
}

async function startTestServer(): Promise<string> {
  testEnv = await setupTestEnvironment({
    serverConfig: {
      mongoUri: process.env.MONGO_URI as string,
      usersDbName: USERS_DB_NAME,
      usersCollectionName: USERS_COLLECTION_NAME,
      jwtSecret: ensureDefined(process.env.JWT_SECRET, 'JWT_SECRET is required'),
      provisionalLoginEnabled: process.env.PROVISIONAL_LOGIN_ENABLED === 'true' || process.env.PROVISIONAL_LOGIN_ENABLED === '1',
      provisionalAuthId: PROVISIONAL_AUTH_ID,
      provisionalAuthSecretMaster: PROVISIONAL_AUTH_SECRET_MASTER,
      provisionalAuthDomain: PROVISIONAL_AUTH_DOMAIN,
      refreshSecretSigningKey: ensureDefined(process.env.REFRESH_SECRET_SIGNING_KEY, 'REFRESH_SECRET_SIGNING_KEY is required'),
      port: Number(process.env.PORT),
    },
  });
  return testEnv.serverUrl;
}

async function loginWithProvisional(serverUrl: string): Promise<string> {
  const provisionalClient = new AuthClient({
    secretMaster: PROVISIONAL_AUTH_SECRET_MASTER,
    authDomain: PROVISIONAL_AUTH_DOMAIN,
    randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
  });
  const provisionalPassword = await provisionalClient.producePassword(PROVISIONAL_AUTH_ID);
  const res = await request(serverUrl)
    .post('/provisional-login')
    .send({ authId: PROVISIONAL_AUTH_ID, password: provisionalPassword });
  const body = parseBody(res);
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
  return body.token as string;
}

describe('BODY_LIMIT env', () => {
  afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
      testEnv = undefined;
    }
    dotenv.config({ path: TEST_ENV_PATH, override: true });
  });

  it('fails with 413 when BODY_LIMIT is not specified and the body exceeds 1mb', async () => {
    delete process.env.BODY_LIMIT;
    const serverUrl = await startTestServer();
    const token = await loginWithProvisional(serverUrl);
    const payload = makeLargeRegisterPayload(`body-limit-default-${Date.now()}`);

    const res = await request(serverUrl)
      .post('/registerUser')
      .set('X-Revlm-JWT', `Bearer ${token}`)
      .set('Content-Type', 'application/ejson')
      .send(EJSON.stringify(payload));

    expect(res.status).toBe(413);
  });

  it('succeeds with the same payload when BODY_LIMIT=2mb is loaded from test.env', async () => {
    dotenv.config({ path: TEST_ENV_PATH, override: true });
    const serverUrl = await startTestServer();
    const token = await loginWithProvisional(serverUrl);
    const authId = `body-limit-2mb-${Date.now()}`;
    const payload = makeLargeRegisterPayload(authId);

    const res = await request(serverUrl)
      .post('/registerUser')
      .set('X-Revlm-JWT', `Bearer ${token}`)
      .set('Content-Type', 'application/ejson')
      .send(EJSON.stringify(payload));

    const body = parseBody(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.user.authId).toBe(authId);
  });
});
