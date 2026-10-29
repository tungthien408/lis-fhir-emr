/** Explicit opt-in process; no default destination and no secrets in errors. */
export interface WorkerConfig {
  emrBaseUrl: string;
  httpTimeoutMs: number;
  leaseMs: number;
  pollMs: number;
  retryDelaysMs: readonly number[];
}

export function validateWorkerConfig(config: WorkerConfig): WorkerConfig {
  let url: URL;
  try { url = new URL(config.emrBaseUrl); } catch { throw new Error("EMR_BASE_URL must be an HTTP(S) origin"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== "/") {
    throw new Error("EMR_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  for (const [key, value, min, max] of [
    ["httpTimeoutMs", config.httpTimeoutMs, 1, 60000],
    ["leaseMs", config.leaseMs, config.httpTimeoutMs + 1000, 3600000],
    ["pollMs", config.pollMs, 10, 60000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid worker ${key}`);
  }
  if (!Array.isArray(config.retryDelaysMs) || config.retryDelaysMs.length > 10
    || config.retryDelaysMs.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 86400000)) {
    throw new Error("Worker retries require at most 10 finite delays of 1..86400000 ms");
  }
  return Object.freeze({ ...config, emrBaseUrl: url.origin, retryDelaysMs: Object.freeze([...config.retryDelaysMs]) });
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  function integer(key: string, fallback: number): number {
    const raw = env[key];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
    return Number(raw);
  }
  const delays = env.MIDDLEWARE_WORKER_RETRY_DELAYS_MS;
  if (delays !== undefined && delays !== "" && !/^\d+(,\d+)*$/.test(delays)) {
    throw new Error("Invalid MIDDLEWARE_WORKER_RETRY_DELAYS_MS");
  }
  return validateWorkerConfig({
    emrBaseUrl: env.EMR_BASE_URL ?? "",
    httpTimeoutMs: integer("MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS", 3000),
    leaseMs: integer("MIDDLEWARE_WORKER_LEASE_MS", 15000),
    pollMs: integer("MIDDLEWARE_WORKER_POLL_MS", 1000),
    retryDelaysMs: delays === undefined ? [2000, 4000, 8000] : delays === "" ? [] : delays.split(",").map(Number),
  });
}
