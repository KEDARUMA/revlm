import { EJSON } from 'bson';
import { AuthClient } from '@kedaruma/revlm-shared';
import type { DefaultId } from '@kedaruma/revlm-shared/models/mongo-doc-base-types';
import RevlmDBDatabase from "./RevlmDBDatabase";
import { LoginResponse, ProvisionalLoginResponse, RegisterUserResponse, User } from './Revlm.types';

type EmailPasswordCredential = { type: 'emailPassword'; email: string; password: string };
type UserInput = Omit<User, 'userType'> & { userType: User['userType'] | string };

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SESSION_HEADER_NAME = 'x-revlm-session-id';

export type CookieStore = {
  getCookieHeader: (url: string) => string | undefined | Promise<string | undefined>;
  setCookie: (url: string, setCookieHeader: string) => void | Promise<void>;
};

function normalizeLogLevel(value?: string): LogLevel {
  if (!value) return 'info';
  const lowered = value.toLowerCase();
  if (lowered === 'true' || lowered === '1') return 'debug';
  if (lowered === 'false' || lowered === '0') return 'error';
  if (lowered === 'error' || lowered === 'warn' || lowered === 'info' || lowered === 'debug') {
    return lowered as LogLevel;
  }
  return 'info';
}

function maskSecret(value?: string): string | undefined {
  if (!value) return undefined;
  return `<...:${value.length}>`;
}

function generateSessionId(): string {
  try {
    const globalCrypto = (globalThis as any)?.crypto;
    if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
      return globalCrypto.randomUUID();
    }
  } catch {
    // ignore: fallback below
  }
  try {
    const nodeCrypto = require('crypto');
    if (nodeCrypto?.randomUUID) return nodeCrypto.randomUUID();
    if (nodeCrypto?.randomBytes) return nodeCrypto.randomBytes(16).toString('hex');
  } catch {
    // ignore: fallback below
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSetCookieHeaders(res: Response): string[] {
  const raw = (res.headers as any)?.getSetCookie?.() ?? res.headers.get('set-cookie');
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function getRevlmClientVersion(): string {
  try {
    const pkg = require('../package.json');
    if (pkg && typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore: bundle/runtime may not expose package.json
  }
  const globalVersion = (globalThis as any)?.REVLM_CLIENT_VERSION;
  return typeof globalVersion === 'string' ? globalVersion : 'unknown';
}

export type RevlmOptions = {
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  // provisional (optional) client-side configuration
  provisionalEnabled?: boolean;
  provisionalAuthSecretMaster?: string;
  provisionalAuthDomain?: string;
  // automatically set token returned from login/provisionalLogin into the client
  autoSetToken?: boolean;
  // automatically refresh on 401 once and retry the original request
  autoRefreshOn401?: boolean;
  // log level for init log output: 'error' | 'warn' | 'info' | 'debug'
  logLevel?: LogLevel;
  sessionId?: string;
  sessionIdProvider?: () => string | Promise<string>;
  cookieStore?: CookieStore;
};

export type RevlmResponse<T = any> = {
  ok: boolean;
  error?: string;
  token?: string;
  user?: any;
  result?: T;
  [k: string]: any;
};

export default class Revlm {
  baseUrl: string;
  fetchImpl: typeof fetch;
  defaultHeaders: Record<string, string>;
  private _token: string | undefined;
  private provisionalEnabled: boolean;
  private provisionalAuthSecretMaster: string;
  private provisionalAuthDomain: string;
  private autoSetToken: boolean;
  private autoRefreshOn401: boolean;
  private cookieCheckPromise?: Promise<void>;
  private logLevel: LogLevel;
  private refreshPromise: Promise<RevlmResponse> | undefined;
  private sessionId: string | undefined;
  private sessionIdProvider: (() => string | Promise<string>) | undefined;
  private cookieStore: CookieStore | undefined;

  constructor(baseUrl: string, opts: RevlmOptions = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : (undefined as any));
    this.defaultHeaders = opts.defaultHeaders || {};
    this.provisionalEnabled = opts.provisionalEnabled || false;
    this.provisionalAuthSecretMaster = opts.provisionalAuthSecretMaster || '';
    this.provisionalAuthDomain = opts.provisionalAuthDomain || '';
    this.autoSetToken = opts.autoSetToken ?? true;
    this.autoRefreshOn401 = opts.autoRefreshOn401 || false;
    this.logLevel = normalizeLogLevel(opts.logLevel);
    this.sessionId = opts.sessionId;
    this.sessionIdProvider = opts.sessionIdProvider;
    this.cookieStore = opts.cookieStore;

    if (!this.fetchImpl) {
      throw new Error('No fetch implementation available. Provide fetchImpl in options or run in Node 18+ with global fetch.');
    }

    this.logInfo('🚀 Revlm Client Init', {
      version: getRevlmClientVersion(),
      baseUrl: this.baseUrl,
      autoSetToken: this.autoSetToken,
      autoRefreshOn401: this.autoRefreshOn401,
      provisionalEnabled: this.provisionalEnabled,
      provisionalAuthDomain: this.provisionalAuthDomain || undefined,
      provisionalAuthSecretMaster: maskSecret(this.provisionalAuthSecretMaster),
      defaultHeaders: Object.keys(this.defaultHeaders || {}),
      fetchImplProvided: !!opts.fetchImpl,
      logLevel: this.logLevel,
    });
  }

  private async resolveSessionId(): Promise<string | undefined> {
    if (this.sessionId) return this.sessionId;
    if (this.sessionIdProvider) {
      const provided = await this.sessionIdProvider();
      if (provided) {
        this.sessionId = provided;
        return provided;
      }
    }
    this.sessionId = generateSessionId();
    return this.sessionId;
  }

  private async applyCookieStore(headers: Record<string, string>, url: string): Promise<void> {
    const existing = (headers as any).cookie || (headers as any).Cookie;
    if (!this.cookieStore || existing) return;
    const cookieHeader = await this.cookieStore.getCookieHeader(url);
    if (cookieHeader) headers.cookie = cookieHeader;
  }

  private async storeSetCookies(res: Response, url: string): Promise<void> {
    if (!this.cookieStore) return;
    const setCookies = getSetCookieHeaders(res);
    if (!setCookies.length) return;
    for (const setCookie of setCookies) {
      await this.cookieStore.setCookie(url, setCookie);
    }
  }

  private canLog(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[this.logLevel] >= LOG_LEVEL_RANK[level];
  }

  logError(...args: any[]) {
    if (this.canLog('error')) console.error(...args);
  }

  logWarn(...args: any[]) {
    if (this.canLog('warn')) console.warn(...args);
  }

  logInfo(...args: any[]) {
    if (this.canLog('info')) console.log(...args);
  }

  logDebug(...args: any[]) {
    if (this.canLog('debug')) console.log(...args);
  }

  setToken(token: string) {
    this._token = token;
  }
  getToken() {
    return this._token;
  }
  clearToken() {
    this._token = undefined;
  }

  // Logout clears client-side token (simple, synchronous)
  logout(): void {
    this.clearToken();
  }

  // Call server to refresh token. Uses Authorization header with current token.
  // On success, if autoSetToken is true and res.token is set, update the client token.
  async refreshToken(): Promise<RevlmResponse> {
    if (!this._token) return { ok: false, error: 'No token set' };
    const res = await this.requestWithRetry('/refresh-token', 'POST', undefined, { allowAuthRetry: false, retrying: false });
    if (this.autoSetToken && res && res.ok && res.token) {
      this.setToken(res.token as string);
    }
    return res;
  }

  private async refreshTokenSingleFlight(): Promise<RevlmResponse> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          return await this.refreshToken();
        } finally {
          this.refreshPromise = undefined;
        }
      })();
    }
    return this.refreshPromise;
  }

  // Verify current token with server. If invalid/expired, clear local token.
  async verifyToken(): Promise<RevlmResponse> {
    if (!this._token) return { ok: false, error: 'No token set' };
    const res = await this.request('/verify-token', 'POST');
    // Server returns { ok: false, reason: 'token_expired' | 'invalid_token' | 'no_token' }
    const reason = (res as any).reason || (res as any).error;
    if (res && !res.ok) {
      if (reason === 'invalid_token' || reason === 'token_expired' || reason === 'no_token' || res.status === 401 || res.status === 403) {
        this.clearToken();
      }
    }
    return res;
  }

  private makeHeaders(hasBody: boolean) {
    const headers: Record<string, string> = {
      Accept: 'application/ejson',
      ...this.defaultHeaders,
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/ejson';
    }
    if (this._token) {
      headers['X-Revlm-JWT'] = `Bearer ${this._token}`;
    }
    return headers;
  }

  private async parseResponse(res: Response): Promise<any> {
    const text = await res.text();
    if (!text) return null;
    try {
      return EJSON.parse(text);
    } catch (e) {
      const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;
      throw new Error(`Invalid EJSON response: ${preview}`);
    }
  }

  private async request(path: string, method = 'POST', body?: any): Promise<RevlmResponse> {
    return this.requestWithRetry(path, method, body, { allowAuthRetry: this.autoRefreshOn401, retrying: false });
  }

  private shouldSkipAuthRetry(path: string): boolean {
    const pathname = path.startsWith('http') ? new URL(path).pathname : path;
    return pathname.includes('/login') || pathname.includes('/provisional-login') || pathname.includes('/refresh-token') || pathname.includes('/verify-token');
  }

  private shouldSkipCookieCheck(path: string): boolean {
    const pathname = path.startsWith('http') ? new URL(path).pathname : path;
    return pathname.includes('/cookie-check');
  }

  private decodeJwtPayload(token: string): { exp?: number; iat?: number } | null {
    if (!token) return null;
    const parts = token.split('.');
    const payloadPart = parts[1];
    if (!payloadPart) return null;
    const raw = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : '';
    const base64 = raw + pad;
    let jsonText: string | null = null;
    if (typeof atob === 'function') {
      jsonText = atob(base64);
    } else if (typeof Buffer !== 'undefined') {
      jsonText = Buffer.from(base64, 'base64').toString('utf8');
    }
    if (!jsonText) return null;
    try {
      const payload = JSON.parse(jsonText);
      return { exp: payload?.exp, iat: payload?.iat };
    } catch {
      return null;
    }
  }

  private logTokenTtl(event: string, path: string, tokenOverride?: string) {
    const token = tokenOverride || this._token;
    if (!token) return;
    const payload = this.decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') return;
    const now = Math.floor(Date.now() / 1000);
    const ttlSec = payload.exp - now;
    this.logDebug('### token ttl', {
      event,
      path,
      ttlSec,
      exp: payload.exp,
      iat: payload.iat,
    });
  }

  private async signIfNeeded(
    _url: string,
    _method: string,
    headers: Record<string, string>,
    _body?: string
  ): Promise<{ signedUrl: string; signedHeaders: Record<string, string> }> {
    // SigV4 removed; return headers unchanged.
    // SigV4 は削除済みのためヘッダはそのまま返す。
    return { signedUrl: _url, signedHeaders: headers };
  }

  private async requestWithRetry(
    path: string,
    method = 'POST',
    body?: any,
    opts: { allowAuthRetry: boolean; retrying: boolean } = { allowAuthRetry: false, retrying: false }
  ): Promise<RevlmResponse> {
    const { allowAuthRetry, retrying } = opts;
    if (!this.shouldSkipCookieCheck(path)) {
      await this.ensureCookieSupport();
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const hasBody = body !== undefined;
    const headers = this.makeHeaders(hasBody);
    const sessionId = await this.resolveSessionId();
    if (sessionId) headers[SESSION_HEADER_NAME] = sessionId;
    await this.applyCookieStore(headers, url);
    let serializedBody: string | undefined;
    if (hasBody) {
      serializedBody = EJSON.stringify(body);
    }
    const { signedUrl, signedHeaders } = await this.signIfNeeded(url, method, headers, serializedBody);
    try {
      const res = await this.fetchImpl(signedUrl, {
        method,
        headers: signedHeaders,
        body: serializedBody,
      } as any);
      await this.storeSetCookies(res, signedUrl);
      const parsed = await this.parseResponse(res);
      const out: RevlmResponse = (parsed && typeof parsed === 'object') ? parsed : { ok: res.ok, result: parsed };
      out.status = res.status;
      if (out && out.ok === false && !out.error) {
        // normalize error field for compatibility
        out.error = (parsed as any)?.reason || (parsed as any)?.message || 'Unknown error';
      }
      if (allowAuthRetry && !retrying && res.status === 401 && !this.shouldSkipAuthRetry(path)) {
        const beforePayload = this.decodeJwtPayload(this._token || '');
        const refreshRes = await this.refreshTokenSingleFlight();
        if (!refreshRes.ok) {
          if ((refreshRes as any).reason === 'not_expired') {
            return this.requestWithRetry(path, method, body, { allowAuthRetry: false, retrying: true });
          }
          const refreshFailed = {
            reason: (refreshRes as any).reason,
            status: refreshRes.status,
            error: refreshRes.error,
          };
          this.logDebug('### refresh failed:', refreshFailed, JSON.stringify(refreshFailed));
          if ((refreshRes as any).reason === 'no_refresh_secret') {
            const missingError = new Error('Refresh cookie missing. Provide a cookie-aware fetch implementation for Node/RN.');
            (missingError as any).revlmReason = 'no_refresh_secret';
            throw missingError;
          }
        }
        if (refreshRes && refreshRes.ok && refreshRes.token) {
          const afterPayload = this.decodeJwtPayload(refreshRes.token as string);
          const now = Math.floor(Date.now() / 1000);
          const oldExp = beforePayload?.exp;
          const newExp = afterPayload?.exp;
          this.logDebug('### refresh success', {
            path,
            oldExp,
            newExp,
            oldTtlSec: typeof oldExp === 'number' ? oldExp - now : undefined,
            newTtlSec: typeof newExp === 'number' ? newExp - now : undefined,
          });
          return this.requestWithRetry(path, method, body, { allowAuthRetry: false, retrying: true });
        }
      }
      if (out.ok && !this.shouldSkipCookieCheck(path)) {
        this.logTokenTtl('request_ok', path);
      }
      return out;
    } catch (err: any) {
      if (err && (err as any).revlmReason === 'no_refresh_secret') {
        throw err;
      }
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async login(authId: string, password: string): Promise<LoginResponse> {
    if (!authId || !password) throw new Error('authId and password are required');
    const res = await this.request('/login', 'POST', { authId, password });
    if (this.autoSetToken && res && res.ok && res.token) {
      this.setToken(res.token as string);
    }
    return res as LoginResponse;
  }

  async provisionalLogin(authId: string): Promise<ProvisionalLoginResponse> {
    if (!this.provisionalEnabled) {
      throw new Error('provisional login is disabled by client configuration');
    }
    await this.ensureCookieSupport();
    if (!authId) throw new Error('authId is required');
    const provisionalClient = new AuthClient({ secretMaster: this.provisionalAuthSecretMaster, authDomain: this.provisionalAuthDomain });
    const provisionalPassword = await provisionalClient.producePassword(String(Date.now() * 1000));
    const res = await this.request('/provisional-login', 'POST', { authId, password: provisionalPassword });
    if (this.autoSetToken && res && res.ok && res.token) {
      this.setToken(res.token as string);
    }
    return res as ProvisionalLoginResponse;
  }

  async registerUser(user: UserInput, password: string): Promise<RegisterUserResponse> {
    if (!user) throw new Error('user is required');
    if (!password) throw new Error('password is required');
    const res = await this.request('/registerUser', 'POST', { user, password });
    return res as RegisterUserResponse;
  }

  async deleteUser(params: { _id?: any; authId?: string }) {
    if (!params || (!params._id && !params.authId)) throw new Error('Either _id or authId must be provided');
    return this.request('/deleteUser', 'POST', params);
  }

  async revlmGate(payload: any) {
    if (!payload || typeof payload !== 'object') throw new Error('payload object is required');
    return this.request('/revlm-gate', 'POST', payload);
  }

  db(dbName: string) {
    return new RevlmDBDatabase(dbName, this);
  }

  private async ensureCookieSupport(): Promise<void> {
    if (this.cookieCheckPromise) return this.cookieCheckPromise;
    this.cookieCheckPromise = (async () => {
      const first = await this.requestWithRetry('/cookie-check', 'POST', undefined, { allowAuthRetry: false, retrying: false });
      this.logDebug('### cookie check', { step: 'first', ok: first.ok, reason: (first as any).reason, status: first.status });
      if (first.ok) return;
      if ((first as any).reason !== 'cookie_missing') {
        throw new Error(`Cookie check failed: ${(first as any).reason || first.error || 'unknown_error'}`);
      }
      const second = await this.requestWithRetry('/cookie-check', 'POST', undefined, { allowAuthRetry: false, retrying: false });
      this.logDebug('### cookie check', { step: 'second', ok: second.ok, reason: (second as any).reason, status: second.status });
      if (!second.ok) {
        throw new Error('Cookie support missing. Provide a cookie-aware fetch implementation for Node/RN.');
      }
    })();
    return this.cookieCheckPromise;
  }
}

export { Revlm };

// Realm.Web emulation layer (minimal surface without listeners)
class MongoDBService {
  private _revlm: Revlm;
  constructor(revlm: Revlm) {
    this._revlm = revlm;
  }
  db(dbName: string) {
    return new RevlmDBDatabase(dbName, this._revlm);
  }
}

class Credentials {
  static emailPassword(email: string, password: string): EmailPasswordCredential {
    if (!email || !password) throw new Error('email and password are required');
    return { type: 'emailPassword', email, password };
  }
}

class RevlmUser {
  private _app: App;
  private _token: string;
  private _profile: User;
  functions: {
    callFunction: (_name: string, _args?: any[]) => Promise<any>;
  };
  constructor(app: App, token: string, profile: User) {
    this._app = app;
    this._token = token;
    this._profile = profile || {};
    this.functions = {
      callFunction: async (_name: string, _args?: any[]) => {
        throw new Error('user.functions.callFunction is not implemented in Revlm client');
      },
    };
  }
  get id(): DefaultId {
    return this._profile && this._profile._id ? this._profile._id : '';
  }
  get accessToken(): string {
    return this._token;
  }
  get profile(): User {
    return this._profile;
  }
  mongoClient(_serviceName = 'mongodb-atlas'): MongoDBService {
    return new MongoDBService(this._app.revlm);
  }
  async logOut() {
    await this._app.logOut();
  }
}

class App {
  private _currentUser: RevlmUser | null = null;
  private _users: Record<string, RevlmUser> = {};
  revlm: Revlm;
  emailPasswordAuth: {
    registerUser: (email: string, password: string) => Promise<RevlmResponse>;
    deleteUser: (email: string) => Promise<RevlmResponse>;
  };

  constructor(baseUrl: string, opts: RevlmOptions & { id?: string } = {}) {
    this.revlm = new Revlm(baseUrl, opts);
    this.emailPasswordAuth = {
      registerUser: async (email: string, password: string) => {
        return this.revlm.registerUser({ authId: email, userType: 'user', roles: ['user'] }, password);
      },
      deleteUser: async (email: string) => {
        return this.revlm.deleteUser({ authId: email });
      },
    };
  }

  private getUserKey(user: RevlmUser): string {
    return user && user.id ? String(user.id) : 'current';
  }

  get currentUser(): RevlmUser | null {
    return this._currentUser;
  }

  get allUsers(): Record<string, RevlmUser> {
    return { ...this._users };
  }

  async logIn(cred: EmailPasswordCredential): Promise<RevlmUser> {
    if (!cred || cred.type !== 'emailPassword') {
      throw new Error('Unsupported credentials type');
    }
    const res = await this.revlm.login(cred.email, cred.password);
    this.revlm.logInfo('### App:login res:', res);
    if (!res || !res.ok || !res.token) {
      const errMsg = res && !res.ok ? res.error : 'login failed';
      const err: any = new Error(errMsg);
      const anyRes: any = res;
      if (anyRes && typeof anyRes === 'object') {
        if (anyRes.code !== undefined) err.code = anyRes.code;
        if (anyRes.status !== undefined) err.status = anyRes.status;
        if (anyRes.reason !== undefined) err.reason = anyRes.reason;
        err.response = anyRes;
      }
      throw err;
    }
    this.revlm.setToken(res.token as string);
    const user = new RevlmUser(this, res.token as string, res.user);
    const userKey = this.getUserKey(user);
    this._users[userKey] = user;
    this._currentUser = user;
    return user;
  }

  switchUser(user: RevlmUser): RevlmUser {
    if (!user) throw new Error('user is required');
    this._currentUser = user;
    this.revlm.setToken(user.accessToken);
    return user;
  }

  async removeUser(user: RevlmUser): Promise<void> {
    if (!user) return;
    const userKey = this.getUserKey(user);
    delete this._users[userKey];
    if (this._currentUser === user) {
      await this.logOut();
    }
  }

  async logOut(): Promise<void> {
    this.revlm.logout();
    this._currentUser = null;
  }

  // Realm compatibility: allow deleteUser(user) pattern
  async deleteUser(user: RevlmUser): Promise<void> {
    if (!user) return;
    const authId = (user.profile && (user.profile as any).authId) || user.id;
    await this.revlm.deleteUser({ authId });
    await this.removeUser(user);
  }
}

export { App, Credentials, MongoDBService, RevlmUser };
