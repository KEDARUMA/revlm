import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import { getEnv } from './env';

let cachedClient: Revlm | null = null;

export function getRevlmClient(): Revlm {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  // keep refresh cookie raw value to bypass native store mutation.
  // refresh cookieの生値を保持してネイティブストアの変形を回避する。
  let refreshCookieOverride: string | undefined;
  const normalizeCookieValue = (value?: string) => {
    if (!value) return value;
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      return value.slice(1, -1);
    }
    return value;
  };
  // Fetch wrapper for request/response logging.
  // リクエスト/レスポンスのログ用ラッパー。
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const baseHeaders = new Headers();
    if (init?.headers) {
      new Headers(init.headers as any).forEach((value, key) => {
        baseHeaders.set(key, value);
      });
    } else if (typeof input !== 'string') {
      (input as Request).headers.forEach((value, key) => {
        baseHeaders.set(key, value);
      });
    }
    const headers = Object.fromEntries(baseHeaders.entries()) as Record<string, string>;
    const isRefreshRequest = url.includes('/refresh-token');
    if (isRefreshRequest && refreshCookieOverride) {
      // Send refresh secret via header when Cookie is not used.
      // Cookieを使わない前提でリフレッシュ秘密をヘッダ送信する。
      headers['x-revlm-refresh'] = refreshCookieOverride;
      delete headers.cookie;
    }
    if (isRefreshRequest) {
      const rawCookie = (headers as Record<string, string>).cookie || '';
      const refreshHeader = (headers as Record<string, string>)['x-revlm-refresh'] || '';
      const jwtHeader = (headers as Record<string, string>)['x-revlm-jwt'] || '';
      console.log('[cookie] refresh-token request cookie', rawCookie || '<empty>');
      console.log('[cookie] refresh-token request x-revlm-refresh', refreshHeader ? `${refreshHeader.slice(0, 24)}...` : '<empty>');
      console.log('[cookie] refresh-token request x-revlm-jwt', jwtHeader ? `${jwtHeader.slice(0, 24)}...` : '<empty>');
    }
    const res = await fetch(input, {
      ...init,
      headers,
      credentials: isRefreshRequest ? 'omit' : 'include',
    });
    try {
      const setCookieHeader = (res.headers as any)?.getSetCookie?.() ?? res.headers.get('set-cookie');
      if (setCookieHeader) {
        console.log('[cookie] response set-cookie', { url, setCookieHeader });
        const raw = Array.isArray(setCookieHeader) ? setCookieHeader.join(',') : setCookieHeader;
        const match = raw.match(/revlm_refresh=([^;]+)/);
        if (match && match[1]) {
          refreshCookieOverride = normalizeCookieValue(match[1]);
        }
      }
    } catch (err: unknown) {
      console.log('[cookie] response log error', { err });
    }
    return res;
  };
  // Use RN crypto for AuthClient.
  // AuthClient 用に RN crypto を使う。
  const randomBytes = (length: number) => {
    const out = new Uint8Array(length);
    (global.crypto as any).getRandomValues(out);
    return out;
  };

  cachedClient = new Revlm(env.baseUrl, {
    provisionalEnabled: env.provisionalLoginEnabled,
    provisionalAuthSecretMaster: env.provisionalAuthSecretMaster,
    provisionalAuthDomain: env.provisionalAuthDomain,
    sessionId: env.sessionId,
    autoSetToken: true,
    autoRefreshOn401: env.autoRefreshOn401,
    fetchImpl,
    randomBytes,
    logLevel: env.logLevel as any,
  });

  return cachedClient;
}
