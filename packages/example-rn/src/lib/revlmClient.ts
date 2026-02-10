import { Revlm } from '@kedaruma/revlm-client/revlm-compat';
import { getEnv } from './env';

let cachedClient: Revlm | null = null;

export function getRevlmClient(): Revlm {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  cachedClient = new Revlm(env.baseUrl, {
    provisionalEnabled: env.provisionalLoginEnabled,
    provisionalAuthSecretMaster: env.provisionalAuthSecretMaster,
    provisionalAuthDomain: env.provisionalAuthDomain,
    sessionId: env.sessionId,
    autoSetToken: true,
    autoRefreshOn401: env.autoRefreshOn401,
    logLevel: env.logLevel as any,
  });

  return cachedClient;
}
