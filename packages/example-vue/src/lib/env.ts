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

// Read required Vite env values for the demo.
// デモ用の必須Vite環境変数を読み取る。
export function getEnv(): EnvConfig {
  const raw = import.meta.env as Record<string, string | undefined>;
  const baseUrl = raw.VITE_REVLM_BASE_URL;
  const usersDbName = raw.VITE_USERS_DB_NAME;
  const sessionId = raw.VITE_VUE_REVLM_SESSION_ID;
  const provisionalLoginEnabled = raw.VITE_PROVISIONAL_LOGIN_ENABLED;
  const provisionalAuthId = raw.VITE_PROVISIONAL_AUTH_ID;
  const provisionalAuthSecretMaster = raw.VITE_PROVISIONAL_AUTH_SECRET_MASTER;
  const provisionalAuthDomain = raw.VITE_PROVISIONAL_AUTH_DOMAIN;
  const autoRefreshOn401 = raw.VITE_AUTO_REFRESH_ON_401;
  const logLevel = raw.VITE_LOG_LEVEL;

  const missing: string[] = [];
  if (!baseUrl) missing.push("VITE_REVLM_BASE_URL");
  if (!usersDbName) missing.push("VITE_USERS_DB_NAME");
  if (!sessionId) missing.push("VITE_VUE_REVLM_SESSION_ID");
  if (!provisionalLoginEnabled) missing.push("VITE_PROVISIONAL_LOGIN_ENABLED");
  if (!provisionalAuthId) missing.push("VITE_PROVISIONAL_AUTH_ID");
  if (!provisionalAuthSecretMaster) missing.push("VITE_PROVISIONAL_AUTH_SECRET_MASTER");
  if (!provisionalAuthDomain) missing.push("VITE_PROVISIONAL_AUTH_DOMAIN");
  if (!autoRefreshOn401) missing.push("VITE_AUTO_REFRESH_ON_401");
  if (!logLevel) missing.push("VITE_LOG_LEVEL");

  if (missing.length) {
    throw new Error(
      [
        "Missing required .env values for example-vue:",
        ...missing.map((key) => `  ${key}=...`),
      ].join("\n")
    );
  }

  const parseBool = (value: string, key: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(`Invalid boolean for ${key}: ${value}`);
  };

  return {
    baseUrl,
    usersDbName,
    sessionId,
    provisionalLoginEnabled: parseBool(provisionalLoginEnabled, "VITE_PROVISIONAL_LOGIN_ENABLED"),
    provisionalAuthId,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
    autoRefreshOn401: parseBool(autoRefreshOn401, "VITE_AUTO_REFRESH_ON_401"),
    logLevel,
  };
}
