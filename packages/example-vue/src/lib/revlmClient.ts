import { Revlm } from "@kedaruma/revlm-client/revlm-compat";
import { getEnv } from "./env";

let cachedClient: Revlm | null = null;

// Create or reuse a singleton Revlm client for the demo.
// デモ用の Revlm クライアントを生成（シングルトン）。
export function getRevlmClient(): Revlm {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  const fetchImpl: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      credentials: "include",
    });
  // Use Web crypto for AuthClient.
  // AuthClient 用に Web crypto を使う。
  const randomBytes = (length: number) => {
    const out = new Uint8Array(length);
    (globalThis.crypto as Crypto).getRandomValues(out);
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
    logLevel: env.logLevel,
  });

  return cachedClient;
}
