/** Browser-only fixture host, refuses every database except the runner's empty tmpfs instance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import express, { type Express } from "express";
import { Pool } from "pg";

const token = process.env.PHASE23_ISOLATION_TOKEN;
assert.match(token ?? "", /^[0-9a-f-]{36}$/i);
const names = ["LIS", "MIDDLEWARE", "EMR"] as const;
const pools = names.map((name) => {
  const url = new URL(process.env[name + "_REPOSITORY_TEST_DATABASE_URL"] ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5432"); assert.equal(url.pathname, "/dacn_db");
  process.env[name + "_DATABASE_URL"] = url.href;
  return new Pool({ connectionString: url.href });
});
const [lisPool, mwPool, emrPool] = pools;
for (const [i, pool] of pools.entries()) {
  const identity = (await pool.query("select current_user as role,shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()")).rows[0];
  assert.equal(identity.role, ["lis_app", "integration_app", "emr_app"][i]);
  assert.equal(identity.marker, "spp66-disposable:" + token);
}
for (const [pool, tables] of [[lisPool, ["lis.patients", "lis.test_catalog", "lis.results", "lis.publish_events", "lis.dispatch_attempts"]],
  [mwPool, ["integration.exchange_transactions", "integration.exchange_attempts", "integration.exchange_events"]],
  [emrPool, ["emr.patients", "emr.patient_links", "emr.lab_results"]]] as const) {
  for (const table of tables) assert.equal((await pool.query("select count(*)::int as n from " + table)).rows[0].n, 0, "Refuse existing data: " + table);
}
const patientId = "PHASE23-P", code = "PHASE23-TEST", patientKey = randomUUID();
await lisPool.query("insert into lis.patients(patient_id,source_subject_id,display_label) values ($1,$1,'Phase 2.3 synthetic only')", [patientId]);
await lisPool.query("insert into lis.test_catalog(test_code,test_name,fluid,category,accepted_units,catalog_version) values ($1,'Phase 2.3 synthetic analyte','Blood','Chemistry',$2,'phase23-v1')", [code, JSON.stringify(["mg/dL"])]);
const ids = ["PHASE23-FINAL", "PHASE23-READY", "PHASE23-CONFLICT", ".", "..", "%2E", "%2E%2E", "/", "%", "+", "Kết quả/🧪?#",
  ...Array.from({ length: 31 }, (_, i) => "PHASE23-R-" + String(i).padStart(2, "0"))];
for (const id of ids) await lisPool.query(`insert into lis.results(result_id,patient_id,test_code,value_num,unit,reference_low,reference_high,effective_at,result_status,provenance)
  values ($1,$2,$3,'3.6000','mg/dL','3.3','5.1','2026-11-04T05:00:00.123456Z',$4,'{"fixture":"phase23 synthetic only"}')`,
  [id, patientId, code, id === "PHASE23-READY" ? "READY" : "FINAL"]);
await emrPool.query("insert into emr.patients(patient_key,display_label) values ($1,'Phase 2.3 expected patient')", [patientKey]);
await emrPool.query("insert into emr.patient_links(identifier_system,identifier_value,patient_key) values ('https://example.org/lis/patient',$1,$2)", [patientId, patientKey]);
const { publishResult } = await import("../../src/lis/service.js");
const { getPublishEventByResultId } = await import("../../src/lis/repository.js");
assert.equal((await publishResult("PHASE23-CONFLICT")).kind, "created");
const originalConflict = await getPublishEventByResultId("PHASE23-CONFLICT");
await lisPool.query("update lis.results set value_num='9.1' where result_id='PHASE23-CONFLICT'");
writeFileSync("/evidence/browser-fixture.json", JSON.stringify({ source: "Synthetic only; runner-owned tmpfs; independent expected patient", ids, patientId, patientKey, code, originalConflict }, null, 2));
const { registerLisRoutes } = await import("../../src/lis/controller.js");
const { registerMiddlewareRoutes } = await import("../../src/middleware/controller.js");
const { emrJsonParser, registerEmrRoutes } = await import("../../src/emr/controller.js");
const { lisDatabase } = await import("../../src/lis/db.js");
const { middlewareDatabase } = await import("../../src/middleware/db.js");
const { emrDatabase } = await import("../../src/emr/db.js");
function trace(app: Express, name: string) {
  app.use((req, res, next) => {
    const original = res.json.bind(res);
    res.json = (body: unknown) => {
      appendFileSync("/evidence/browser-api-http.jsonl", JSON.stringify({ service: name, method: req.method, path: req.originalUrl, status: res.statusCode, body }) + "\n");
      return original(body);
    };
    next();
  });
}
const lisApp = express(); trace(lisApp, "lis"); lisApp.use(express.json({ limit: "1mb" })); registerLisRoutes(lisApp);
const mwApp = express(); trace(mwApp, "middleware"); mwApp.use(express.json({ limit: "1mb" })); registerMiddlewareRoutes(mwApp);
const emrApp = express(); trace(emrApp, "emr"); emrApp.use(emrJsonParser()); registerEmrRoutes(emrApp);
const servers = [lisApp.listen(33101, "0.0.0.0"), mwApp.listen(33102, "0.0.0.0"), emrApp.listen(33103, "0.0.0.0")];
const workerEnv = { ...process.env, MIDDLEWARE_BASE_URL: "http://127.0.0.1:33102", EMR_BASE_URL: "http://127.0.0.1:33103",
  LIS_DISPATCHER_POLL_MS: "100", MIDDLEWARE_WORKER_POLL_MS: "100" };
const children = ["src/lis/dispatcher-main.ts", "src/middleware/worker-main.ts"].map((file) =>
  spawn(process.execPath, ["--import", "tsx", file], { env: workerEnv, stdio: "inherit" }));
console.log("Isolated Phase 2.3 APIs ready; actual Dispatcher and Worker entry points started.");
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  await Promise.all([...pools.map((pool) => pool.end()), lisDatabase.close(), middlewareDatabase.close(), emrDatabase.close()]);
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
