import { ConfigurationError } from './load-config.js';
import type { MeasurementConfig } from './measurement-runner.js';
/** Measurement opts are opt-in env vars, so the existing 82-A CLI contract stays intact. */
export function parseMeasurementConfig(env: NodeJS.ProcessEnv, lisBaseUrl: string, httpTimeoutMs: number): MeasurementConfig | null {
  if (env.SPP82_MEASURE !== '1') return null;
  const positive = (name: string, fallback: number, max = 2_147_483_647) => {
    const raw = env[name]; const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new ConfigurationError(`Invalid ${name}`);
    return value;
  };
  const origin = (name: string) => {
    try {
      const url = new URL(env[name] ?? '');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      return url.origin;
    } catch { throw new ConfigurationError(`${name} must be a credential-free HTTP(S) origin`); }
  };
  const scenario = env.SPP82_SCENARIO ?? 'unspecified';
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(scenario)) throw new ConfigurationError('Invalid SPP82_SCENARIO');
  const optionalCount = (name: string) => {
    if (env[name] === undefined) return null;
    const value = /^\d+$/.test(env[name]!) ? Number(env[name]) : NaN;
    if (!Number.isSafeInteger(value) || value < 0) throw new ConfigurationError(`Invalid ${name}`);
    return value;
  };
  const manifestHash = env.SPP82_MANIFEST_HASH ?? null;
  if (manifestHash !== null && !/^[a-f0-9]{64}$/i.test(manifestHash)) throw new ConfigurationError('Invalid SPP82_MANIFEST_HASH');
  return {
    lisBaseUrl, httpTimeoutMs, middlewareBaseUrl: origin('MIDDLEWARE_BASE_URL'), emrBaseUrl: origin('EMR_BASE_URL'),
    pollingIntervalMs: positive('SPP82_POLL_MS', 1000), runTimeoutMs: positive('SPP82_RUN_TIMEOUT_MS', 120000),
    observerConcurrency: positive('SPP82_OBSERVER_CONCURRENCY', 2, 10), scenario,
    gitCommit: null, manifestHash,
    workerCounts: { dispatcher: optionalCount('SPP82_DECLARED_DISPATCHER_COUNT'), middleware: optionalCount('SPP82_DECLARED_WORKER_COUNT') },
  };
}
