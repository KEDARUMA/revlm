import {
  AUTO_REFRESH_ON_401,
  LOG_LEVEL,
  PROVISIONAL_AUTH_DOMAIN,
  PROVISIONAL_AUTH_ID,
  PROVISIONAL_AUTH_SECRET_MASTER,
  PROVISIONAL_LOGIN_ENABLED,
  REVLM_BASE_URL,
  RN_REVLM_SESSION_ID,
  USERS_DB_NAME,
} from '@env';
import { Platform } from 'react-native';

type EnvConfig = {
  baseUrl: string;
  usersDbName: string;
  sessionId: string;
  provisionalLoginEnabled: boolean;
  provisionalAuthId: string;
  provisionalAuthSecretMaster: string;
  provisionalAuthDomain: string;
  autoRefreshOn401: boolean;
  logLevel: string;
};

function resolveBaseUrlForRuntime(baseUrl: string): string {
  if (Platform.OS !== 'android') return baseUrl;
  return baseUrl.replace(
    /^(http:\/\/)(localhost|127\.0\.0\.1)([:/]|$)/i,
    '$110.0.2.2$3'
  );
}

export function getEnv(): EnvConfig {
  const missing: string[] = [];
  // Require and collect missing env values.
  // 必須の環境変数を収集する。
  const requireEnv = (value: string | undefined, key: string): string => {
    if (!value) {
      missing.push(key);
      return '';
    }
    return value;
  };

  const baseUrl = requireEnv(REVLM_BASE_URL, 'REVLM_BASE_URL');
  const usersDbName = requireEnv(USERS_DB_NAME, 'USERS_DB_NAME');
  const sessionId = requireEnv(RN_REVLM_SESSION_ID, 'RN_REVLM_SESSION_ID');
  const provisionalLoginEnabledRaw = requireEnv(PROVISIONAL_LOGIN_ENABLED, 'PROVISIONAL_LOGIN_ENABLED');
  const provisionalAuthId = requireEnv(PROVISIONAL_AUTH_ID, 'PROVISIONAL_AUTH_ID');
  const provisionalAuthSecretMaster = requireEnv(
    PROVISIONAL_AUTH_SECRET_MASTER,
    'PROVISIONAL_AUTH_SECRET_MASTER'
  );
  const provisionalAuthDomain = requireEnv(PROVISIONAL_AUTH_DOMAIN, 'PROVISIONAL_AUTH_DOMAIN');
  const autoRefreshOn401Raw = requireEnv(AUTO_REFRESH_ON_401, 'AUTO_REFRESH_ON_401');
  const logLevel = requireEnv(LOG_LEVEL, 'LOG_LEVEL');

  if (missing.length) {
    throw new Error(
      ['Missing required .env values for example-rn:', ...missing.map((key) => `  ${key}=...`)].join(
        '\n'
      )
    );
  }

  const parseBool = (value: string, key: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`Invalid boolean for ${key}: ${value}`);
  };

  return {
    baseUrl: resolveBaseUrlForRuntime(baseUrl),
    usersDbName,
    sessionId,
    provisionalLoginEnabled: parseBool(provisionalLoginEnabledRaw, 'PROVISIONAL_LOGIN_ENABLED'),
    provisionalAuthId,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
    autoRefreshOn401: parseBool(autoRefreshOn401Raw, 'AUTO_REFRESH_ON_401'),
    logLevel,
  };
}
