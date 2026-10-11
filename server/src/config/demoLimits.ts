const definitions = {
  sessionRequests: ['DEMO_SESSION_REQUESTS_PER_MINUTE', 60, 10_000, 1],
  clientRequests: ['DEMO_CLIENT_REQUESTS_PER_MINUTE', 120, 10_000, 1],
  globalRequests: ['DEMO_GLOBAL_REQUESTS_PER_MINUTE', 300, 100_000, 1],
  clientSessions: ['DEMO_CLIENT_SESSIONS_PER_HOUR', 5, 1_000, 1],
  globalSessions: ['DEMO_GLOBAL_SESSIONS_PER_HOUR', 30, 10_000, 1],
  maxClients: ['DEMO_MAX_TRACKED_CLIENTS', 1000, 10_000, 1],
  aiConcurrency: ['DEMO_AI_CONCURRENCY', 2, 10, 1],
  sessionAI: ['DEMO_AI_REQUESTS_PER_SESSION', 20, 1_000, 0],
  clientAI: ['DEMO_AI_REQUESTS_PER_CLIENT_HOUR', 30, 10_000, 0],
  globalAI: ['DEMO_AI_REQUESTS_PER_MINUTE', 10, 1_000, 0],
  dailyAI: ['DEMO_AI_REQUESTS_PER_DAY', 100, 100_000, 0],
  dailyTokens: ['DEMO_AI_RESERVED_TOKENS_PER_DAY', 2_000_000, 1_000_000_000, 0],
  requestBytes: ['DEMO_AI_MAX_REQUEST_BYTES', 196_608, 1_048_576, 1],
} as const;
export type DemoLimits = { -readonly [K in keyof typeof definitions]: number };

/** Fail closed on invalid configuration; zero AI allowances are an operator kill switch. */
export function getDemoLimits(env: NodeJS.ProcessEnv = process.env): DemoLimits {
  const result = {} as DemoLimits;
  for (const key of Object.keys(definitions) as (keyof DemoLimits)[]) {
    const [name, fallback, max, min] = definitions[key];
    const raw = env[name]?.trim();
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if ((raw && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    result[key] = value;
  }
  return result;
}
