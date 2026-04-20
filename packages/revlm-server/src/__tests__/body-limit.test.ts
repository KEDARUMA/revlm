import request from 'supertest';
import { EJSON } from 'bson';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import { jest } from '@jest/globals';
import { AuthClient } from '@kedaruma/revlm-shared/auth-token';
import { ensureDefined } from '@kedaruma/revlm-shared/utils/asserts';
import { randomBytes as nodeRandomBytes } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import net from 'net';
import { MongoMemoryServer } from 'mongodb-memory-server';

const filenameUrl = fileURLToPath(import.meta.url);
const __dirname = path.dirname(filenameUrl);
const TEST_ENV_PATH = path.join(__dirname, 'test.env');
const START_ENTRY_PATH = path.join(__dirname, '..', 'start.ts');
const BASE_ENV = dotenv.parse(await fs.readFile(TEST_ENV_PATH, 'utf8')) as Record<string, string>;
const RELEVANT_ENV_KEYS = [
  'MONGO_URI',
  'USERS_DB_NAME',
  'USERS_COLLECTION_NAME',
  'PROVISIONAL_LOGIN_ENABLED',
  'PROVISIONAL_AUTH_ID',
  'PROVISIONAL_AUTH_SECRET_MASTER',
  'PROVISIONAL_AUTH_DOMAIN',
  'JWT_SECRET',
  'REFRESH_SECRET_SIGNING_KEY',
  'PORT',
  'BODY_LIMIT',
  'BODY_WARN_THRESHOLD',
  'LOG_LEVEL',
];

jest.setTimeout(120000);

const USERS_DB_NAME = ensureDefined(BASE_ENV.USERS_DB_NAME, 'USERS_DB_NAME is required');
const USERS_COLLECTION_NAME = ensureDefined(BASE_ENV.USERS_COLLECTION_NAME, 'USERS_COLLECTION_NAME is required');
const PROVISIONAL_AUTH_DOMAIN = ensureDefined(BASE_ENV.PROVISIONAL_AUTH_DOMAIN, 'PROVISIONAL_AUTH_DOMAIN is required');
const PROVISIONAL_AUTH_SECRET_MASTER = ensureDefined(BASE_ENV.PROVISIONAL_AUTH_SECRET_MASTER, 'PROVISIONAL_AUTH_SECRET_MASTER is required');
const PROVISIONAL_AUTH_ID = ensureDefined(BASE_ENV.PROVISIONAL_AUTH_ID, 'PROVISIONAL_AUTH_ID is required');
const LARGE_BLOB = 'x'.repeat(1280 * 1024);

type StartScenario = {
  cleanup: () => Promise<void>;
  serverUrl: string;
};

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

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

function clearEnv(keys: string[]) {
  for (const key of keys) {
    delete process.env[key];
  }
}

function snapshotProcessListeners() {
  return {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
    uncaughtException: process.listeners('uncaughtException'),
    unhandledRejection: process.listeners('unhandledRejection'),
  };
}

function restoreProcessListeners(snapshot: ReturnType<typeof snapshotProcessListeners>) {
  for (const event of Object.keys(snapshot) as Array<keyof ReturnType<typeof snapshotProcessListeners>>) {
    const original = new Set(snapshot[event]);
    for (const listener of process.listeners(event)) {
      if (!original.has(listener)) {
        process.removeListener(event, listener);
      }
    }
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(port);
      });
    });
  });
}

function serializeDotenv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

async function waitForServerReady(serverUrl: string): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 15000) {
    try {
      const res = await request(serverUrl)
        .post('/provisional-login')
        .send({ authId: PROVISIONAL_AUTH_ID, password: 'not-used-for-readiness' });
      if (res.status !== 404 && res.status !== 500) {
        return;
      }
      lastError = new Error(`unexpected readiness status: ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error('server did not become ready');
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

async function startViaStartEntrypoint(bodyLimit?: string): Promise<StartScenario> {
  const mongod = await MongoMemoryServer.create({
    instance: {
      dbName: USERS_DB_NAME,
    },
  });
  const port = await getAvailablePort();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revlm-body-limit-'));
  const envFile: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(BASE_ENV).filter(([key]) => key !== 'BODY_LIMIT' && key !== 'BODY_WARN_THRESHOLD'),
    ),
    MONGO_URI: mongod.getUri(),
    USERS_DB_NAME,
    USERS_COLLECTION_NAME,
    PORT: String(port),
  };
  if (bodyLimit) {
    envFile.BODY_LIMIT = bodyLimit;
  }
  await fs.writeFile(path.join(tempDir, '.env'), `${serializeDotenv(envFile)}\n`, 'utf8');

  const envSnapshot = snapshotEnv(RELEVANT_ENV_KEYS);
  const listenersSnapshot = snapshotProcessListeners();
  const cwdBefore = process.cwd();
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  let stopServer: (() => Promise<unknown>) | undefined;

  clearEnv(RELEVANT_ENV_KEYS);
  process.chdir(tempDir);

  try {
    jest.resetModules();
    await jest.isolateModulesAsync(async () => {
      await import(pathToFileURL(START_ENTRY_PATH).href);
      const serverModule = await import(pathToFileURL(path.join(__dirname, '..', 'server.ts')).href);
      stopServer = serverModule.stopServer as () => Promise<unknown>;
    });
    const serverUrl = `http://127.0.0.1:${port}`;
    await waitForServerReady(serverUrl);

    return {
      serverUrl,
      cleanup: async () => {
        try {
          if (stopServer) {
            await stopServer();
          }
        } finally {
          exitSpy.mockRestore();
          restoreEnv(envSnapshot);
          restoreProcessListeners(listenersSnapshot);
          process.chdir(cwdBefore);
          await mongod.stop();
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    exitSpy.mockRestore();
    restoreEnv(envSnapshot);
    restoreProcessListeners(listenersSnapshot);
    process.chdir(cwdBefore);
    await mongod.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

describe('BODY_LIMIT env via start.ts', () => {
  it('fails with 413 when BODY_LIMIT is not specified and the body exceeds 1mb', async () => {
    const scenario = await startViaStartEntrypoint();
    try {
      const token = await loginWithProvisional(scenario.serverUrl);
      const payload = makeLargeRegisterPayload(`body-limit-default-${Date.now()}`);

      const res = await request(scenario.serverUrl)
        .post('/registerUser')
        .set('X-Revlm-JWT', `Bearer ${token}`)
        .set('Content-Type', 'application/ejson')
        .send(EJSON.stringify(payload));

      expect(res.status).toBe(413);
    } finally {
      await scenario.cleanup();
    }
  });

  it('succeeds with the same payload when BODY_LIMIT=2mb is loaded from .env', async () => {
    const scenario = await startViaStartEntrypoint('2mb');
    try {
      const token = await loginWithProvisional(scenario.serverUrl);
      const authId = `body-limit-2mb-${Date.now()}`;
      const payload = makeLargeRegisterPayload(authId);

      const res = await request(scenario.serverUrl)
        .post('/registerUser')
        .set('X-Revlm-JWT', `Bearer ${token}`)
        .set('Content-Type', 'application/ejson')
        .send(EJSON.stringify(payload));

      const body = parseBody(res);
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.user.authId).toBe(authId);
    } finally {
      await scenario.cleanup();
    }
  });
});
