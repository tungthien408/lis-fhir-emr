import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { TestContext } from "node:test";
import express from "express";
import { Pool } from "pg";
import { isRecord, requestJson } from "../emr/http-test-helpers.js";
import { createFixture, digest } from "./d3-fixtures.js";
import { eventually, listen, relay } from "./d3-network.js";

export type DbRow = Record<string, unknown>;
export function field(row: DbRow, name: string): string { const value = row[name]; assert.equal(typeof value, "string", name); return value as string; }
export function one(rows: DbRow[], name: string): DbRow { assert.equal(rows.length, 1, `Exactly one ${name}`); return rows[0]; }
const tables = {
  "lis.patients": { owner: "lis", times: [], decimals: [] },
  "lis.test_catalog": { owner: "lis", times: [], decimals: [] },
  "lis.results": { owner: "lis", times: ["effective_at"], decimals: ["value_num", "reference_low", "reference_high"] },
  "lis.publish_events": { owner: "lis", times: ["published_at", "next_retry_at", "lease_until", "acked_at"], decimals: [] },
  "lis.dispatch_attempts": { owner: "lis", times: ["started_at", "sent_at", "response_at", "ended_at"], decimals: [] },
  "integration.exchange_transactions": { owner: "middleware", times: ["published_at", "received_at", "validated_at", "mapping_started_at",
    "transformed_at", "first_sent_at", "target_stored_at", "verified_at", "completed_at", "next_retry_at", "lease_until"], decimals: [] },
  "integration.exchange_attempts": { owner: "middleware", times: ["started_at", "sent_at", "response_at", "ended_at"], decimals: [] },
  "integration.exchange_events": { owner: "middleware", times: ["occurred_at"], decimals: [] },
  "emr.patients": { owner: "emr", times: [], decimals: [] },
  "emr.patient_links": { owner: "emr", times: [], decimals: [] },
  "emr.lab_results": { owner: "emr", times: ["effective_at", "received_at", "stored_at"], decimals: ["quantity", "low", "high"] },
} as const;

export async function createHarness(t: TestContext) {
  const token = process.env.D3_DATABASE_ISOLATION_TOKEN;
  assert.ok(token && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token),
    "D3 needs a disposable database: run npm run test:e2e:postgres");
  const services = [["lis", "LIS", "lis_app"], ["middleware", "MIDDLEWARE", "integration_app"], ["emr", "EMR", "emr_app"]] as const;
  const urls = services.map(([, env, role]) => {
    const raw = process.env[`${env}_REPOSITORY_TEST_DATABASE_URL`]; assert.ok(raw, `Missing ${env} test connection`);
    let url: URL; try { url = new URL(raw); } catch { throw new Error("Invalid D3 database URL"); }
    assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1"
      && url.pathname === "/dacn_db" && url.port && url.username === role && url.password && !url.search && !url.hash,
    "D3 refuses remote, default or non-test database settings");
    return url;
  });
  assert.equal(new Set(urls.map((url) => url.host)).size, 1, "All three roles must use the same disposable instance");
  const pools = { lis: new Pool({ connectionString: urls[0].href, max: 4, connectionTimeoutMillis: 3000 }),
    middleware: new Pool({ connectionString: urls[1].href, max: 4, connectionTimeoutMillis: 3000 }),
    emr: new Pool({ connectionString: urls[2].href, max: 4, connectionTimeoutMillis: 3000 }) };
  t.after(async () => { await Promise.all(Object.values(pools).map((pool) => pool.end())); });
  for (const [name, , role] of services) {
    const identity = (await pools[name].query(`select current_user as role,current_database() as database,
      shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`)).rows[0];
    assert.equal(identity.role, role); assert.equal(identity.database, "dacn_db");
    assert.equal(identity.marker, `spp66-disposable:${token}`, "Refuse writes outside the runner-owned database");
  }
  async function assertEmpty() {
    for (const [table, spec] of Object.entries(tables)) {
      assert.equal((await pools[spec.owner].query(`select count(*)::int as total from ${table}`)).rows[0].total, 0,
        `Refuse to claim or clear existing data in ${table}`);
    }
  }
  await assertEmpty(); // No writes, production imports, HTTP servers or workers before this guard.
  for (const [index, [, env]] of services.entries()) process.env[`${env}_DATABASE_URL`] = urls[index].href;
  const { registerLisRoutes } = await import("../../src/lis/controller.js");
  const { registerMiddlewareRoutes } = await import("../../src/middleware/controller.js");
  const { emrJsonParser, registerEmrRoutes } = await import("../../src/emr/controller.js");
  const { LisDispatcher } = await import("../../src/lis/dispatcher.js");
  const { MiddlewareWorker } = await import("../../src/middleware/worker.js");
  const { loadDispatcherConfig } = await import("../../src/lis/dispatcher-config.js");
  const { loadWorkerConfig } = await import("../../src/middleware/worker-config.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const { emrDatabase } = await import("../../src/emr/db.js");
  t.after(async () => { await Promise.all([lisDatabase.close(), middlewareDatabase.close(), emrDatabase.close()]); });
  const lisApp = express(); lisApp.use(express.json({ limit: "1mb" })); registerLisRoutes(lisApp);
  const middlewareApp = express(); middlewareApp.use(express.json({ limit: "1mb" })); registerMiddlewareRoutes(middlewareApp);
  const emrApp = express(); emrApp.use(emrJsonParser()); registerEmrRoutes(emrApp);
  const lis = await listen(t, lisApp); const middleware = await listen(t, middlewareApp); const emr = await listen(t, emrApp);
  const middlewareWire = await relay(t, middleware.baseUrl); const emrWire = await relay(t, emr.baseUrl);
  const dispatcherConfig = loadDispatcherConfig({ MIDDLEWARE_BASE_URL: middlewareWire.baseUrl,
    LIS_DISPATCHER_HTTP_TIMEOUT_MS: "3000", LIS_DISPATCHER_LEASE_MS: "15000", LIS_DISPATCHER_POLL_MS: "20",
    LIS_DISPATCHER_RETRY_DELAYS_MS: "500,1000", LIS_DISPATCHER_MAX_ATTEMPTS: "3" });
  const workerConfig = loadWorkerConfig({ EMR_BASE_URL: emrWire.baseUrl, MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS: "3000",
    MIDDLEWARE_WORKER_LEASE_MS: "15000", MIDDLEWARE_WORKER_POLL_MS: "20", MIDDLEWARE_WORKER_RETRY_DELAYS_MS: "500,1000" });

  /** Direct authorized SQL, independent of all three production Repository readers. */
  async function rows(table: keyof typeof tables, where: string, values: unknown[], order = "") {
    const spec = tables[table];
    const preserved: string[] = spec.times.map((column) => `'${column}',to_char(r.${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
    preserved.push(...spec.decimals.map((column) => `'${column}',r.${column}::text`));
    const overrides = preserved.length ? ` || jsonb_build_object(${preserved.join(",")})` : "";
    return (await pools[spec.owner].query<{ record: DbRow }>(`select to_jsonb(r)${overrides} as record from ${table} r where ${where}${order ? ` order by ${order}` : ""}`, values)).rows.map((item) => item.record);
  }

  function startProcess(context: TestContext, kind: "dispatcher" | "worker", patch: NodeJS.ProcessEnv = {}) {
    const path = kind === "dispatcher" ? "lis/dispatcher-main.ts" : "middleware/worker-main.ts";
    const child = spawn(process.execPath, ["--import", "tsx", `src/${path}`], { cwd: new URL("../../", import.meta.url),
      env: { ...process.env, MIDDLEWARE_BASE_URL: middlewareWire.baseUrl, EMR_BASE_URL: emrWire.baseUrl,
        LIS_DISPATCHER_HTTP_TIMEOUT_MS: "3000", LIS_DISPATCHER_LEASE_MS: "15000", LIS_DISPATCHER_POLL_MS: "20",
        LIS_DISPATCHER_RETRY_DELAYS_MS: "500,1000", LIS_DISPATCHER_MAX_ATTEMPTS: "3",
        MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS: "3000", MIDDLEWARE_WORKER_LEASE_MS: "15000", MIDDLEWARE_WORKER_POLL_MS: "20",
        MIDDLEWARE_WORKER_RETRY_DELAYS_MS: "500,1000", ...patch }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    child.stdout.on("data", (buffer: Buffer) => { output += buffer.toString(); });
    child.stderr.on("data", (buffer: Buffer) => { output += buffer.toString(); });
    child.once("error", () => { exit = { code: 1, signal: null }; });
    child.once("exit", (code, signal) => { exit = { code, signal }; });
    async function stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
      if (!exit) child.kill(signal);
      try { await eventually(() => exit !== undefined, `${kind} process must exit`, 5000); }
      finally { if (!exit) child.kill("SIGKILL"); }
      return exit!;
    }
    context.after(async () => { await stop("SIGKILL"); });
    return { stop, output: () => output,
      async healthy() { assert.equal(exit, undefined, `${kind} process exited before completing its work`); },
    };
  }

  async function scenario(context: TestContext, options: { variant?: string; linked?: boolean } = {}) {
    const fixture = createFixture(options.variant); const { source, catalog, resultId, patientId, patientKey, decoyKey } = fixture;
    const mwStart = middlewareWire.traces.length; const emrStart = emrWire.traces.length;
    context.after(async () => {
      for (const table of ["exchange_events", "exchange_attempts"]) await pools.middleware.query(`delete from integration.${table}
        where exchange_id in (select exchange_id from integration.exchange_transactions where source_system='lis-demo' and source_result_id=$1)`, [resultId]);
      await pools.middleware.query("delete from integration.exchange_transactions where source_system='lis-demo' and source_result_id=$1", [resultId]);
      await pools.emr.query("delete from emr.lab_results where external_system='https://example.org/lis/result' and external_id=$1", [resultId]);
      await pools.emr.query("delete from emr.patient_links where patient_key=any($1::uuid[])", [[patientKey, decoyKey]]);
      await pools.emr.query("delete from emr.patients where patient_key=any($1::uuid[])", [[patientKey, decoyKey]]);
      await pools.lis.query("delete from lis.dispatch_attempts where event_id in (select event_id from lis.publish_events where result_id=$1)", [resultId]);
      await pools.lis.query("delete from lis.publish_events where result_id=$1", [resultId]);
      await pools.lis.query("delete from lis.results where result_id=$1", [resultId]);
      await pools.lis.query("delete from lis.test_catalog where test_code=$1", [catalog.test_code]);
      await pools.lis.query("delete from lis.patients where patient_id=$1", [patientId]);
    });
    await pools.lis.query("insert into lis.patients(patient_id,source_subject_id,display_label) values ($1,$1,'D3 synthetic only')", [patientId]);
    await pools.lis.query("insert into lis.test_catalog(test_code,test_name,fluid,category,accepted_units,catalog_version) values ($1,$2,$3,$4,$5,$6)",
      [catalog.test_code, catalog.test_name, catalog.fluid, catalog.category, JSON.stringify(catalog.accepted_units), catalog.catalog_version]);
    await pools.lis.query(`insert into lis.results(result_id,patient_id,test_code,value_num,unit,reference_low,reference_high,effective_at,result_status,provenance)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [resultId, patientId, catalog.test_code, source.value_num, source.unit,
      source.reference_low, source.reference_high, source.effective_at, source.result_status, JSON.stringify(source.provenance)]);
    await pools.emr.query("insert into emr.patients(patient_key,display_label) values ($1,$2),($3,'D3-SYNTHETIC-DECOY')",
      [patientKey, fixture.expectedPatientLabel, decoyKey]);
    await pools.emr.query("insert into emr.patient_links(identifier_system,identifier_value,patient_key) values ($1,$2,$3),($4,$5,$3)",
      ["urn:d3:wrong-patient-namespace", patientId, decoyKey, "https://example.org/lis/patient", `${patientId}-OTHER`]);
    if (options.linked !== false) await pools.emr.query("insert into emr.patient_links(identifier_system,identifier_value,patient_key) values ($1,$2,$3)",
      ["https://example.org/lis/patient", patientId, patientKey]);
    const originalSource = one(await rows("lis.results", "result_id=$1", [resultId]), "synthetic source result");
    assert.deepEqual(originalSource, { ...source, effective_at: fixture.columns.effective_at });
    const publishHttp: { method: string; path: string; status: number; body: unknown }[] = [];
    async function publish() {
      const path = `/api/results/${encodeURIComponent(resultId)}/publish`;
      const response = await requestJson(lis.baseUrl, path, { method: "POST" });
      publishHttp.push({ method: "POST", path, ...response }); return response;
    }
    const published = await publish(); assert.equal(published.status, 202); assert.ok(isRecord(published.body));
    const initialEvent = one(await rows("lis.publish_events", "result_id=$1", [resultId]), "Publish event");
    const eventId = field(initialEvent, "event_id");
    assert.deepEqual(published.body, { event_id: eventId, result_id: resultId, dispatch_status: "PENDING", exchange_id: null });
    assert.equal(initialEvent.dispatch_status, "PENDING"); assert.equal(initialEvent.dispatch_attempt_count, 0);
    assert.deepEqual(initialEvent.source_snapshot, fixture.snapshot); assert.equal(initialEvent.source_hash, digest(fixture.snapshot));
    assert.equal(initialEvent.source_system, "lis-demo");
    const envelope = { event_id: eventId, source_system: "lis-demo", source_result_id: resultId,
      source_snapshot: structuredClone(fixture.snapshot), source_hash: digest(fixture.snapshot),
      published_at: new Date(field(initialEvent, "published_at")).toISOString() };
    const eventRows = () => rows("lis.publish_events", "result_id=$1", [resultId]);
    const exchangeRows = () => rows("integration.exchange_transactions", "source_system='lis-demo' and source_result_id=$1", [resultId]);
    async function state() {
      const [lisEvents, lisAttempts, exchanges, attempts, events, results, patients, links] = await Promise.all([
        eventRows(), rows("lis.dispatch_attempts", "event_id=$1", [eventId], "attempt_no"), exchangeRows(),
        rows("integration.exchange_attempts", "exchange_id in (select exchange_id from integration.exchange_transactions where source_system='lis-demo' and source_result_id=$1)", [resultId], "started_at,attempt_id"),
        rows("integration.exchange_events", "exchange_id in (select exchange_id from integration.exchange_transactions where source_system='lis-demo' and source_result_id=$1)", [resultId], "occurred_at,log_event_id"),
        rows("emr.lab_results", "external_system='https://example.org/lis/result' and external_id=$1", [resultId]),
        rows("emr.patients", "patient_key=any($1::uuid[])", [[patientKey, decoyKey]], "patient_key"),
        rows("emr.patient_links", "patient_key=any($1::uuid[])", [[patientKey, decoyKey]], "identifier_system,identifier_value"),
      ]);
      return { lis: { event: one(lisEvents, "LIS event"), attempts: lisAttempts },
        middleware: { exchanges, attempts, events }, emr: { results, patients, links } };
    }
    async function waitFor(predicate: (current: Awaited<ReturnType<typeof state>>) => boolean, message: string) {
      await eventually(async () => predicate(await state()), message);
    }
    return { ...fixture, originalSource, initialEvent, eventId, envelope, published, publishHttp, publish, state, waitFor,
      dispatcher: () => new LisDispatcher(dispatcherConfig), worker: () => new MiddlewareWorker(workerConfig),
      middlewareHttp: () => middlewareWire.traces.slice(mwStart), emrHttp: () => emrWire.traces.slice(emrStart),
      async waitUntilDue() {
        await eventually(async () => (await pools.lis.query("select next_retry_at<=clock_timestamp() as due from lis.publish_events where event_id=$1", [eventId])).rows[0].due === true,
          "LIS retry must become due by database time");
      },
      async waitUntilExpired() {
        await eventually(async () => (await pools.lis.query("select lease_until<=clock_timestamp() as expired from lis.publish_events where event_id=$1", [eventId])).rows[0].expired === true,
          "LIS lease must naturally expire by database time");
      },
    };
  }
  return { pools, rows, lis, middleware, emr, middlewareWire, emrWire, scenario, assertEmpty, startProcess,
    dispatcherConfig, workerConfig };
}
export type D3Harness = Awaited<ReturnType<typeof createHarness>>;
export type D3Scenario = Awaited<ReturnType<D3Harness["scenario"]>>;
export type D3State = Awaited<ReturnType<D3Scenario["state"]>>;
