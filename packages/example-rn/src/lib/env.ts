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

export function getEnv(): EnvConfig {
  const missing: string[] = [];
  if (!REVLM_BASE_URL) missing.push('REVLM_BASE_URL');
  if (!USERS_DB_NAME) missing.push('USERS_DB_NAME');
  if (!RN_REVLM_SESSION_ID) missing.push('RN_REVLM_SESSION_ID');
  if (!PROVISIONAL_LOGIN_ENABLED) missing.push('PROVISIONAL_LOGIN_ENABLED');
  if (!PROVISIONAL_AUTH_ID) missing.push('PROVISIONAL_AUTH_ID');
  if (!PROVISIONAL_AUTH_SECRET_MASTER) missing.push('PROVISIONAL_AUTH_SECRET_MASTER');
  if (!PROVISIONAL_AUTH_DOMAIN) missing.push('PROVISIONAL_AUTH_DOMAIN');
  if (!AUTO_REFRESH_ON_401) missing.push('AUTO_REFRESH_ON_401');
  if (!LOG_LEVEL) missing.push('LOG_LEVEL');

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
    baseUrl: REVLM_BASE_URL,
    usersDbName: USERS_DB_NAME,
    sessionId: RN_REVLM_SESSION_ID,
    provisionalLoginEnabled: parseBool(PROVISIONAL_LOGIN_ENABLED, 'PROVISIONAL_LOGIN_ENABLED'),
    provisionalAuthId: PROVISIONAL_AUTH_ID,
    provisionalAuthSecretMaster: PROVISIONAL_AUTH_SECRET_MASTER,
    provisionalAuthDomain: PROVISIONAL_AUTH_DOMAIN,
    autoRefreshOn401: parseBool(AUTO_REFRESH_ON_401, 'AUTO_REFRESH_ON_401'),
    logLevel: LOG_LEVEL,
  };
}
