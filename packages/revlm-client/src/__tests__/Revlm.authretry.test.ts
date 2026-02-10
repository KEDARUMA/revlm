import { jest } from '@jest/globals';
import Revlm from '../Revlm';

type MockResponseInit = { status: number; body: any };

function makeMockResponse({ status, body }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      // Minimal Headers stub for cookie parsing.
      // cookie パース用の最小 Headers スタブ。
      get() {
        return null;
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  } as any;
}
// Use Node crypto for AuthClient.
// AuthClient 用に Node crypto を使う。

describe('Revlm autoRefreshOn401', () => {
  // 401でリフレッシュした後に同じリクエストを再送する
  it('retries original request after refresh on 401', async () => {
    const fetchMock = jest.fn()
      // cookie-check -> 428 (set-cookie)
      .mockResolvedValueOnce(makeMockResponse({ status: 428, body: { ok: false, reason: 'cookie_missing' } }))
      // cookie-check -> 200 (cookie sent)
      .mockResolvedValueOnce(makeMockResponse({ status: 200, body: { ok: true } }))
      // initial call -> 401
      .mockResolvedValueOnce(makeMockResponse({ status: 401, body: { ok: false, reason: 'token_expired' } }))
      // refresh-token -> 200 with new token
      .mockResolvedValueOnce(makeMockResponse({ status: 200, body: { ok: true, token: 'new-token' } }))
      // retry original -> 200 success
      .mockResolvedValueOnce(makeMockResponse({ status: 200, body: { ok: true, result: { data: 1 } } }));

    const client = new Revlm('https://api.example.com', {
      fetchImpl: fetchMock as any,
      autoRefreshOn401: true,
    });
    client.setToken('expired-token');

    const res = await client.revlmGate({ db: 'db', collection: 'col', method: 'find', filter: {} });

    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ data: 1 });
    expect(client.getToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((fetchMock.mock.calls[2][0] as string)).toContain('/revlm-gate');
    expect((fetchMock.mock.calls[3][0] as string)).toContain('/refresh-token');
    expect((fetchMock.mock.calls[4][0] as string)).toContain('/revlm-gate');
  });

  // autoRefreshOn401がfalseのときは401でもリトライしない
  it('does not retry when autoRefreshOn401 is false', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeMockResponse({ status: 428, body: { ok: false, reason: 'cookie_missing' } }))
      .mockResolvedValueOnce(makeMockResponse({ status: 200, body: { ok: true } }))
      .mockResolvedValueOnce(makeMockResponse({ status: 401, body: { ok: false, reason: 'token_expired' } }));
    const client = new Revlm('https://api.example.com', {
      fetchImpl: fetchMock as any,
      autoRefreshOn401: false,
    });
    client.setToken('expired-token');

    const res = await client.revlmGate({ db: 'db', collection: 'col', method: 'find', filter: {} });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
