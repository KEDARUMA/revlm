import { randomBytes as nodeRandomBytes } from 'crypto';
import { EJSON } from 'bson';
import { jest } from '@jest/globals';
import Revlm from '../Revlm';

type MockStateStore = {
  get: jest.Mock<Promise<string | undefined>, [string]>;
  set: jest.Mock<Promise<void>, [string, string]>;
  remove: jest.Mock<Promise<void>, [string]>;
  data: Map<string, string>;
};

const STORE_KEY_REFRESH = 'refreshSecret';
// Use Node crypto for AuthClient.
// AuthClient 用に Node crypto を使う。
const randomBytes = (length: number) => new Uint8Array(nodeRandomBytes(length));

function createStateStore(seed?: Record<string, string>): MockStateStore {
  // Simple in-memory stateStore for tests.
  // テスト用のインメモリ stateStore。
  const data = new Map<string, string>(seed ? Object.entries(seed) : []);
  const get = jest.fn(async (key: string) => data.get(key));
  const set = jest.fn(async (key: string, value: string) => {
    data.set(key, value);
  });
  const remove = jest.fn(async (key: string) => {
    data.delete(key);
  });
  return { get, set, remove, data };
}

function buildResponse(payload: any, status = 200, headers?: Record<string, string>) {
  const body = payload === undefined ? '' : EJSON.stringify(payload);
  const res = new Response(body, { status });
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => res.headers.set(key, value));
  }
  return res;
}

function createMockFetch(handlers: Record<string, (req: Request) => Response>) {
  // Route by pathname for deterministic responses.
  // pathname でルーティングして決定的なレスポンスを返す。
  return jest.fn(async (input: RequestInfo, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const pathname = new URL(request.url).pathname;
    const handler = handlers[pathname];
    if (!handler) {
      return buildResponse({ ok: false, error: `No handler for ${pathname}` }, 500);
    }
    return handler(request);
  });
}

describe('Revlm stateStore for refreshSecret', () => {
  it('stores refreshSecret from set-cookie', async () => {
    const store = createStateStore();
    const fetchImpl = createMockFetch({
      '/cookie-check': () => buildResponse({ ok: false, reason: 'cookie_missing' }, 428),
      '/login': () =>
        buildResponse(
          { ok: true, token: 'login-token' },
          200,
          { 'set-cookie': 'revlm_refresh=stored-secret; Path=/' }
        ),
    });
    const client = new Revlm('https://example.test', {
      fetchImpl,
      randomBytes,
      stateStore: store,
    });

    const res = await client.login('demo', 'demo-pass');
    expect(res.ok).toBe(true);
    expect(store.set).toHaveBeenCalledWith(STORE_KEY_REFRESH, 'stored-secret');
  });

  it('loads refreshSecret from stateStore for header refresh', async () => {
    const store = createStateStore({ [STORE_KEY_REFRESH]: 'stored-secret' });
    let refreshHeader = '';
    const fetchImpl = createMockFetch({
      '/cookie-check': () => buildResponse({ ok: false, reason: 'cookie_missing' }, 428),
      '/refresh-token': (req) => {
        refreshHeader = req.headers.get('x-revlm-refresh') || '';
        return buildResponse({ ok: true, token: 'new-token' }, 200);
      },
    });
    const client = new Revlm('https://example.test', {
      fetchImpl,
      randomBytes,
      stateStore: store,
      sessionId: 'example-session',
    });
    client.setToken('old-token');

    const res = await client.refreshToken();
    expect(res.ok).toBe(true);
    expect(store.get).toHaveBeenCalledWith(STORE_KEY_REFRESH);
    expect(refreshHeader).toBe('stored-secret');
  });

  it('removes refreshSecret on no_refresh_secret', async () => {
    const store = createStateStore({ [STORE_KEY_REFRESH]: 'stored-secret' });
    const fetchImpl = createMockFetch({
      '/cookie-check': () => buildResponse({ ok: false, reason: 'cookie_missing' }, 428),
      '/revlm-gate': () => buildResponse({ ok: false, reason: 'token_expired' }, 401),
      '/refresh-token': () =>
        buildResponse({ ok: false, reason: 'no_refresh_secret', code: 10400 }, 428),
    });
    const client = new Revlm('https://example.test', {
      fetchImpl,
      randomBytes,
      stateStore: store,
      autoRefreshOn401: true,
      sessionId: 'example-session',
    });
    client.setToken('old-token');

    await expect(
      client.revlmGate({ db: 'db', collection: 'col', method: 'find', filter: {} })
    ).rejects.toThrow('Refresh cookie missing');
    expect(store.remove).toHaveBeenCalledWith(STORE_KEY_REFRESH);
  });
});
