/** Separate opt-in background process, independent of the receipt HTTP server. */
import { middlewareDatabase } from "./db.js";
import { MiddlewareWorker } from "./worker.js";
import { loadWorkerConfig } from "./worker-config.js";

const stopping = new AbortController();
const stop = () => stopping.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const config = loadWorkerConfig();
  const readiness = await middlewareDatabase.check();
  if (readiness.status !== "ready") throw new Error("Worker database is not ready");
  console.log("[Middleware Worker] Started.");
  await new MiddlewareWorker(config).run(stopping.signal, () => {
    console.error("[Middleware Worker] Processing interrupted; recovery will use the persisted lease.");
  });
} catch {
  console.error("[Middleware Worker] Startup failed; check worker configuration and database readiness.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await middlewareDatabase.close().catch(() => { process.exitCode = 1; });
}
