/** D2: explicit destination, bounded timers and one shared retry policy per deployment. */
export interface DispatcherConfig {
  middlewareBaseUrl: string;
  httpTimeoutMs: number;
  leaseMs: number;
  pollMs: number;
  maxAttempts: number;
  retryDelaysMs: readonly number[];
}

export function validateDispatcherConfig(config: DispatcherConfig): DispatcherConfig {
  let url: URL;
  try { url = new URL(config.middlewareBaseUrl); }
  catch { throw new Error("MIDDLEWARE_BASE_URL must be an HTTP(S) origin"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MIDDLEWARE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  for (const [key, value, minimum, maximum] of [
    ["httpTimeoutMs", config.httpTimeoutMs, 1, 60000],
    ["leaseMs", config.leaseMs, config.httpTimeoutMs + 1000, 3600000],
    ["pollMs", config.pollMs, 10, 60000],
    ["maxAttempts", config.maxAttempts, 1, 100],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid dispatcher ${key}`);
  }
  if (!Array.isArray(config.retryDelaysMs) || config.retryDelaysMs.length !== config.maxAttempts - 1
    || config.retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 1 || delay > 86400000)) {
    throw new Error("Dispatcher requires maxAttempts - 1 retry delays of 1..86400000 ms");
  }
  return Object.freeze({ ...config, middlewareBaseUrl: url.origin, retryDelaysMs: Object.freeze([...config.retryDelaysMs]) });
}

export function loadDispatcherConfig(env: NodeJS.ProcessEnv = process.env): DispatcherConfig {
  function integer(key: string, fallback: number): number {
    const raw = env[key];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
    return Number(raw);
  }
  const rawDelays = env.LIS_DISPATCHER_RETRY_DELAYS_MS;
  if (rawDelays !== undefined && rawDelays !== "" && !/^\d+(,\d+)*$/.test(rawDelays)) {
    throw new Error("Invalid LIS_DISPATCHER_RETRY_DELAYS_MS");
  }
  const retryDelaysMs = rawDelays === undefined ? [2000, 4000, 8000] : rawDelays === "" ? [] : rawDelays.split(",").map(Number);
  return validateDispatcherConfig({
    middlewareBaseUrl: env.MIDDLEWARE_BASE_URL ?? "",
    httpTimeoutMs: integer("LIS_DISPATCHER_HTTP_TIMEOUT_MS", 3000),
    leaseMs: integer("LIS_DISPATCHER_LEASE_MS", 15000),
    pollMs: integer("LIS_DISPATCHER_POLL_MS", 1000),
    maxAttempts: integer("LIS_DISPATCHER_MAX_ATTEMPTS", retryDelaysMs.length + 1),
    retryDelaysMs,
  });
}
