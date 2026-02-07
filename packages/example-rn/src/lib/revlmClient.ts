import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import CookieManager from '@react-native-cookies/cookies';
import setCookieParser from 'set-cookie-parser';
import { getEnv } from './env';

let cachedClient: Revlm | null = null;

export function getRevlmClient(): Revlm {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  // keep refresh cookie raw value to bypass native store mutation.
  // refresh cookieの生値を保持してネイティブストアの変形を回避する。
  let refreshCookieOverride: string | undefined;
  // Detailed cookie debugging helpers.
  // Cookieの詳細デバッグ用ヘルパー。
  const toLogString = (value: unknown): string => {
    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack,
      });
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const normalizeCookieValue = (value?: string) => {
    if (!value) return value;
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      return value.slice(1, -1);
    }
    return value;
  };
  const splitSetCookie = (raw: string): string[] => {
    const parser = setCookieParser as unknown as {
      splitCookiesString?: (value: string) => string[];
    };
    if (parser?.splitCookiesString) return parser.splitCookiesString(raw);
    return [raw];
  };

  const cookieStore = {
    // Provide Cookie header from native cookie store.
    // ネイティブCookieストアからCookieヘッダを生成する。
    getCookieHeader: async (url: string) => {
      try {
        if (url.includes('/refresh-token') && refreshCookieOverride) {
          return `revlm_refresh=${refreshCookieOverride}`;
        }
        const readJar = async (useWebKit: boolean) => {
          try {
            const jar = await CookieManager.get(url, useWebKit);
            return jar || {};
          } catch (err: unknown) {
            console.log('[cookie] getCookieHeader jar error', { url, useWebKit }, toLogString(err));
            return {};
          }
        };
        let jar = await readJar(false);
        let entries = Object.entries(jar || {});
        if (!entries.length) {
          // Fallback to WebKit cookie store when native store is empty.
          // ネイティブストアが空の場合、WebKitストアも参照する。
          jar = await readJar(true);
          entries = Object.entries(jar || {});
        }
        if (!entries.length) return undefined;
        const header = entries
          .map(([name, data]) => {
            const rawValue = typeof data === 'string' ? data : data?.value;
            const value = normalizeCookieValue(rawValue);
            return value ? `${name}=${value}` : '';
          })
          .filter(Boolean)
          .join('; ');
        return header || undefined;
      } catch (err: unknown) {
        console.log('[cookie] getCookieHeader error', { url, err });
        return undefined;
      }
    },
    // Save Set-Cookie into native cookie store.
    // Set-CookieをネイティブCookieストアへ保存する。
    setCookie: async (url: string, setCookieHeader: string) => {
      try {
        const cookies = splitSetCookie(setCookieHeader);
        const parseCookieForSet = (raw: string) => {
          const parts = raw.split(';').map((part) => part.trim());
          const [nameValue, ...attrs] = parts;
          if (!nameValue) return null;
          const eq = nameValue.indexOf('=');
          if (eq === -1) return null;
          const name = nameValue.slice(0, eq);
          const value = nameValue.slice(eq + 1);
          const parsed: {
            name: string;
            value: string;
            domain?: string;
            path?: string;
            expires?: Date;
            secure?: boolean;
            httpOnly?: boolean;
          } = {
            name,
            value,
          };
          for (const attr of attrs) {
            const [key, ...rest] = attr.split('=');
            const normalizedKey = key.toLowerCase();
            const attrValue = rest.join('=');
            if (normalizedKey === 'domain') parsed.domain = attrValue;
            if (normalizedKey === 'path') parsed.path = attrValue;
            if (normalizedKey === 'expires') parsed.expires = new Date(attrValue);
            if (normalizedKey === 'max-age') {
              const seconds = Number(attrValue);
              if (!Number.isNaN(seconds)) parsed.expires = new Date(Date.now() + seconds * 1000);
            }
            if (normalizedKey === 'secure') parsed.secure = true;
            if (normalizedKey === 'httponly') parsed.httpOnly = true;
          }
          return parsed;
        };
        for (const cookie of cookies) {
          const parsedForOverride = parseCookieForSet(cookie);
          if (parsedForOverride?.name === 'revlm_refresh' && parsedForOverride.value) {
            refreshCookieOverride = normalizeCookieValue(parsedForOverride.value);
          }
          try {
            // Also write to WebKit store for consistency across APIs.
            // WebKitストアにも書き込み、API間の差を吸収する。
            await CookieManager.setFromResponse(url, cookie);
            await CookieManager.setFromResponse(url, cookie, true);
          } catch (err: unknown) {
            console.log('[cookie] setFromResponse error', { url, cookie }, toLogString(err));
            // Fallback to manual cookie parsing + set.
            // 手動パースして CookieManager.set にフォールバック。
            const parsed = parseCookieForSet(cookie);
            if (!parsed) {
              continue;
            }
            try {
              await CookieManager.set(url, parsed);
              await CookieManager.set(url, parsed, true);
            } catch (fallbackErr: unknown) {
              console.log(
                '[cookie] setFallback error',
                {
                  url,
                  name: parsed.name,
                  valueLen: parsed.value.length,
                },
                toLogString(fallbackErr)
              );
            }
          }
        }
      } catch (err: unknown) {
        console.log('[cookie] setCookie error', { url }, toLogString(err));
      }
    },
  };

  // Fetch wrapper for request/response logging.
  // リクエスト/レスポンスのログ用ラッパー。
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const baseHeaders = new Headers();
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((value, key) => {
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
      // Send refresh secret via header when Cookie header is absent.
      // Cookieヘッダが無い前提でリフレッシュ秘密をヘッダ送信する。
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

  cachedClient = new Revlm(env.baseUrl, {
    provisionalEnabled: env.provisionalLoginEnabled,
    provisionalAuthSecretMaster: env.provisionalAuthSecretMaster,
    provisionalAuthDomain: env.provisionalAuthDomain,
    sessionId: env.sessionId,
    autoSetToken: true,
    autoRefreshOn401: env.autoRefreshOn401,
    fetchImpl,
    cookieStore,
    logLevel: env.logLevel,
  });

  return cachedClient;
}
