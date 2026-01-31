type EnvConfig = {
  baseUrl: string;
  usersDbName: string;
  sessionId: string;
  provisionalAuthSecretMaster: string;
  provisionalAuthDomain: string;
};

// Read required Vite env values for the demo.
// デモ用の必須Vite環境変数を読み取る。
export function getEnv(): EnvConfig {
  const raw = import.meta.env as Record<string, string | undefined>;
  const baseUrl = raw.VITE_REVLM_BASE_URL;
  const usersDbName = raw.VITE_USERS_DB_NAME;
  const sessionId = raw.VITE_VUE_REVLM_SESSION_ID;
  const provisionalAuthSecretMaster = raw.VITE_PROVISIONAL_AUTH_SECRET_MASTER;
  const provisionalAuthDomain = raw.VITE_PROVISIONAL_AUTH_DOMAIN;

  const missing: string[] = [];
  if (!baseUrl) missing.push("VITE_REVLM_BASE_URL");
  if (!usersDbName) missing.push("VITE_USERS_DB_NAME");
  if (!sessionId) missing.push("VITE_VUE_REVLM_SESSION_ID");
  if (!provisionalAuthSecretMaster) missing.push("VITE_PROVISIONAL_AUTH_SECRET_MASTER");
  if (!provisionalAuthDomain) missing.push("VITE_PROVISIONAL_AUTH_DOMAIN");

  if (missing.length) {
    throw new Error(
      [
        "Missing required .env values for example-vue:",
        ...missing.map((key) => `  ${key}=...`),
      ].join("\n")
    );
  }

  return {
    baseUrl,
    usersDbName,
    sessionId,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
  };
}
