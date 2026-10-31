import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import express from "express";
import { Pool } from "pg";
import { createFixture, fixtureFile } from "./c4-fixtures.js";
import { isRecord, requestJson, startHttpServer } from "../emr/http-test-helpers.js";

export interface HttpEvidence {
  method: string; path: string; query: Record<string, string>; content_type: string | null;
  request_body: unknown; status: number; response_body: unknown;
}

/** Refuse writes unless BOTH service connections identify the runner's disposable DB. */
async function assertIsolated(pool: Pool, role: string, token: string) {
  const result = await pool.query(`select current_user as role, current_database() as database,
    shobj_description(oid, 'pg_database') as marker from pg_database where datname=current_database()`);
  assert.equal(result.rows[0].role, role);
  assert.equal(result.rows[0].database, "dacn_db");
  assert.equal(result.rows[0].marker, `spp66-disposable:${token}`, "Refusing writes outside the disposable C4 database");
}

export async function createHarness(t: TestContext) {
  const token = process.env.C4_DATABASE_ISOLATION_TOKEN;
  assert.ok(token && /^[0-9a-f-]{36}$/.test(token), "C4 requires the isolated PostgreSQL runner");
  const urls = ["LIS", "MIDDLEWARE", "EMR"].map((name) => {
    const connection = process.env[`${name}_REPOSITORY_TEST_DATABASE_URL`];
    assert.ok(connection, `Missing ${name} test connection`);
    let url: URL;
    try { url = new URL(connection); } catch { throw new Error("Invalid test database URL"); }
    assert.equal(url.hostname, "127.0.0.1", "C4 only uses the runner's local container");
    assert.equal(url.pathname, "/dacn_db");
    process.env[`${name}_DATABASE_URL`] = connection;
    return url;
  });
  assert.equal(new Set(urls.map((url) => url.host)).size, 1, "Service roles must address the same isolated instance");
  const middlewarePool = new Pool({ connectionString: urls[1].href, connectionTimeoutMillis: 3000 });
  const emrPool = new Pool({ connectionString: urls[2].href, connectionTimeoutMillis: 3000 });
  t.after(async () => { await Promise.all([middlewarePool.end(), emrPool.end()]); });
  await assertIsolated(middlewarePool, "integration_app", token);
  await assertIsolated(emrPool, "emr_app", token);
  const tables = {
    integration: ["exchange_events", "exchange_attempts", "exchange_transactions"],
    emr: ["lab_results", "patient_links", "patients"],
  };
  async function assertEmpty() {
    for (const [schema, names] of Object.entries(tables)) {
      for (const table of names) {
        const result = await (schema === "emr" ? emrPool : middlewarePool)
          .query(`select count(*)::int as total from ${schema}.${table}`);
        assert.equal(result.rows[0].total, 0, `${schema}.${table} must be empty; never reset existing data`);
      }
    }
  }
  await assertEmpty();
  // Import only AFTER overriding normal app URLs with verified isolated connections.
  const { registerEmrRoutes, emrJsonParser } = await import("../../src/emr/controller.js");
  const { registerMiddlewareRoutes } = await import("../../src/middleware/controller.js");
  const { registerLisRoutes } = await import("../../src/lis/controller.js");
  const { MiddlewareWorker } = await import("../../src/middleware/worker.js");
  const repository = await import("../../src/middleware/repository.js");
  const { loadWorkerConfig } = await import("../../src/middleware/worker-config.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const { emrDatabase } = await import("../../src/emr/db.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  t.after(async () => { await Promise.all([middlewareDatabase.close(), emrDatabase.close(), lisDatabase.close()]); });

  const requests: HttpEvidence[] = [];
  const hooks: { beforeRead?: (query: Record<string, string>) => Promise<void> } = {};
  const emrApp = express(); emrApp.use(emrJsonParser());
  emrApp.use(async (req, res, next) => {
    if (req.path !== "/api/observations" && req.path !== "/api/lab-results") { next(); return; }
    const url = new URL(req.originalUrl, "http://localhost");
    const entry: HttpEvidence = { method: req.method, path: req.path, query: Object.fromEntries(url.searchParams),
      content_type: req.get("Content-Type") ?? null, request_body: structuredClone(req.body ?? null), status: 0, response_body: null };
    requests.push(entry);
    const json = res.json.bind(res);
    // Passive recorder: the real Controller chooses the body and status; forward unchanged.
    res.json = (body: unknown) => {
      entry.status = res.statusCode; entry.response_body = structuredClone(body); return json(body);
    };
    // Negative tests change only their PostgreSQL fixture before the real GET runs.
    if (req.method === "GET") await hooks.beforeRead?.(entry.query);
    next();
  });
  registerEmrRoutes(emrApp); // No dependency overrides or fake routes.
  const emr = await startHttpServer(emrApp); t.after(emr.close);
  const middlewareApp = express(); middlewareApp.use(express.json({ limit: "1mb" }));
  registerMiddlewareRoutes(middlewareApp);
  const middleware = await startHttpServer(middlewareApp); t.after(middleware.close);
  const lisApp = express(); lisApp.use(express.json({ limit: "1mb" })); registerLisRoutes(lisApp);
  const lis = await startHttpServer(lisApp); t.after(lis.close);
  const config = loadWorkerConfig({ EMR_BASE_URL: emr.baseUrl, MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS: "3000",
    MIDDLEWARE_WORKER_LEASE_MS: "15000", MIDDLEWARE_WORKER_POLL_MS: "10", MIDDLEWARE_WORKER_RETRY_DELAYS_MS: "50,100" });
  const postObservation = (body: unknown) => requestJson(emr.baseUrl, "/api/observations", {
    method: "POST", headers: { "Content-Type": "application/fhir+json" }, body: JSON.stringify(body),
  });
  const postExchange = (body: unknown) => requestJson(middleware.baseUrl, "/api/exchanges", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  async function scenario(t: TestContext, options: { variant?: string; linked?: boolean } = {}) {
    const fixture = createFixture(options.variant);
    const { patientKey, decoyPatientKey, envelope, columns } = fixture;
    const ownedPatients = [patientKey, decoyPatientKey];
    t.after(async () => {
      delete hooks.beforeRead;
      // Only IDs generated by this scenario are removed; no TRUNCATE or broad DELETE.
      for (const table of ["exchange_events", "exchange_attempts"]) {
        await middlewarePool.query(`delete from integration.${table} where exchange_id in
          (select exchange_id from integration.exchange_transactions where event_id=$1)`, [envelope.event_id]);
      }
      await middlewarePool.query("delete from integration.exchange_transactions where event_id=$1", [envelope.event_id]);
      await emrPool.query("delete from emr.lab_results where external_system=$1 and external_id=$2", [columns.external_system, columns.external_id]);
      await emrPool.query("delete from emr.patient_links where patient_key=any($1::uuid[])", [ownedPatients]);
      await emrPool.query("delete from emr.patients where patient_key=any($1::uuid[])", [ownedPatients]);
    });
    await emrPool.query("insert into emr.patients(patient_key,display_label) values ($1,'C4 synthetic only'),($2,'C4 synthetic only')", ownedPatients);
    await emrPool.query("insert into emr.patient_links(identifier_system,identifier_value,patient_key) values ($1,$2,$3)",
      ["urn:c4:wrong-patient-namespace", envelope.source_snapshot.patient_id, decoyPatientKey]);
    if (options.linked !== false) await emrPool.query("insert into emr.patient_links(identifier_system,identifier_value,patient_key) values ($1,$2,$3)",
      ["https://example.org/lis/patient", envelope.source_snapshot.patient_id, patientKey]);
    const accepted = await postExchange(envelope);
    assert.equal(accepted.status, 202); assert.ok(isRecord(accepted.body));
    assert.equal(accepted.body.source_hash, envelope.source_hash);
    assert.ok(typeof accepted.body.exchange_id === "string");
    const id = accepted.body.exchange_id;
    const worker = new MiddlewareWorker(config);
    const workerHttp: HttpEvidence[] = [];
    async function row() { const found = await repository.getExchangeById(id); assert.ok(found); return found; }
    async function dbRows() {
      // Independent SQL, not the EMR Repository: cast NUMERIC and format UTC at full precision.
      return (await emrPool.query(`select target_id, patient_key, external_system, external_id,
        analyte_system, analyte_code, analyte_display, analyte_context, quantity::text, unit_text,
        low::text, high::text,
        case when isfinite(effective_at) then to_char(effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          else effective_at::text end as effective_at,
        clinical_status, fhir_json,
        to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at,
        to_char(stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stored_at
        from emr.lab_results where external_system=$1 and external_id=$2 order by target_id`,
      [columns.external_system, columns.external_id])).rows;
    }
    return { ...fixture, id, worker, workerHttp, row, dbRows, accepted,
      attempts: () => repository.getExchangeAttempts(id), events: () => repository.getExchangeEvents(id),
      async run(restarted = false) {
        const start = requests.length;
        const result = await (restarted ? new MiddlewareWorker(config) : worker).runOnce();
        workerHttp.push(...requests.slice(start)); assert.equal(result, "processed");
      },
      async waitUntilDue() {
        for (let attempt = 0; attempt < 100; attempt++) {
          const ready = await middlewarePool.query("select next_retry_at <= clock_timestamp() as due from integration.exchange_transactions where exchange_id=$1", [id]);
          if (ready.rows[0].due) return;
          await pause(10);
        }
        assert.fail("Retry did not become due within the bounded wait");
      },
      get: () => requestJson(emr.baseUrl, `/api/lab-results?${new URLSearchParams({ external_system: columns.external_system, external_id: columns.external_id })}`),
      beforeRead(operation: () => Promise<void>) {
        hooks.beforeRead = async (query) => {
          assert.deepEqual(query, { external_system: columns.external_system, external_id: columns.external_id });
          delete hooks.beforeRead; await operation();
        };
      },
    };
  }
  return { lis, middleware, emr, requests, config, repository, middlewarePool, emrPool, scenario,
    assertEmpty, postObservation, postExchange,
    fixtureHash: createHash("sha256").update(readFileSync(fixtureFile)).digest("hex"),
  };
}
export type C4Harness = Awaited<ReturnType<typeof createHarness>>;
export type C4Scenario = Awaited<ReturnType<C4Harness["scenario"]>>;
