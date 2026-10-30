/** Opt-in process. Root .env is loaded by the npm scripts, like the existing Worker. */
import { lisDatabase } from "./db.js";
import { LisDispatcher } from "./dispatcher.js";
import { loadDispatcherConfig } from "./dispatcher-config.js";

const stopping = new AbortController();
const stop = () => stopping.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const config = loadDispatcherConfig();
  if ((await lisDatabase.check()).status !== "ready") throw new Error("Dispatcher database is not ready");
  console.log("[LIS Dispatcher] Started.");
  await new LisDispatcher(config).run(stopping.signal, () => {
    console.error("[LIS Dispatcher] Processing interrupted; recovery will use the persisted lease.");
  });
} catch {
  console.error("[LIS Dispatcher] Startup failed; check dispatcher configuration and database readiness.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await lisDatabase.close().catch(() => { process.exitCode = 1; });
}
