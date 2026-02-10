import { EJSON } from 'bson';
import { jest } from '@jest/globals';
import Revlm from '../Revlm';

function buildResponse(payload: any, status = 200) {
  const body = payload === undefined ? '' : EJSON.stringify(payload);
  return new Response(body, { status });
}

describe('Revlm fetchImpl fallback', () => {
  const originalFetch = (globalThis as any).fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('uses global fetch when fetchImpl is not provided', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const pathname = new URL(request.url).pathname;
      if (pathname === '/cookie-check') {
        return buildResponse({ ok: true }, 200);
      }
      if (pathname === '/login') {
        return buildResponse({ ok: true, token: 'token-from-global-fetch' }, 200);
      }
      return buildResponse({ ok: false, reason: `unexpected_path:${pathname}` }, 500);
    });
    (globalThis as any).fetch = fetchMock as any;

    const client = new Revlm('https://example.test');
    const res = await client.login('demo', 'demo-pass');

    expect(res.ok).toBe(true);
    expect(res.token).toBe('token-from-global-fetch');
    expect(fetchMock).toHaveBeenCalled();
    expect((fetchMock.mock.calls[0][1] as RequestInit)?.credentials).toBe('include');
    expect((fetchMock.mock.calls[1][1] as RequestInit)?.credentials).toBe('include');
  });

  it('throws when both fetchImpl and global fetch are unavailable', () => {
    (globalThis as any).fetch = undefined;
    expect(() => new Revlm('https://example.test')).toThrow(
      'No fetch implementation available. Provide fetchImpl in options or run in Node 18+ with global fetch.'
    );
  });
});
