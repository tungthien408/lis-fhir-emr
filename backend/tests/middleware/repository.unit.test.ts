import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type QueryConfig } from "pg";
import type { ExchangeTransaction } from "../../src/middleware/repository.js";
import { exchangeTransactions } from "../../src/middleware/schema.js";
import { newExchange } from "./fixtures.js";

// Never inherit the application's real database URL.
delete process.env.MIDDLEWARE_DATABASE_URL;
const repository = await import("../../src/middleware/repository.js");
const { middlewareDatabase } = await import("../../src/middleware/db.js");

test("all Repository operations fail explicitly when Middleware is unconfigured", async () => {
  for (const operation of [
    () => repository.createExchange(newExchange()),
    () => repository.getExchangeById("00000000-0000-4000-8000-000000000001"),
    () => repository.getExchangeByEventId("00000000-0000-4000-8000-000000000001"),
    () => repository.getExchangeBySourceResult("synthetic", "missing"),
    () => repository.listExchanges(),
    () => repository.getExchangeEvents("00000000-0000-4000-8000-000000000001"),
    () => repository.appendExchangeEvent({ exchangeId: "missing", eventType: "TEST" }),
    () => repository.getExchangeAttempts("00000000-0000-4000-8000-000000000001", "SEND"),
  ]) {
    await assert.rejects(operation, /MIDDLEWARE_DATABASE_URL is not configured/);
  }
});

// Stub only the PostgreSQL wire boundary. Real Drizzle still builds statements,
// maps rows and manages BEGIN/COMMIT/ROLLBACK; these tests open no sockets.
const stored: ExchangeTransaction = {
  exchangeId: "00000000-0000-4000-8000-000000000001",
  eventId: "00000000-0000-4000-8000-000000000002",
  sourceSystem: "synthetic", sourceResultId: "synthetic", sourceHash: "a".repeat(64),
  sourcePayload: { synthetic: true }, status: "FAILED", sendAttemptCount: 2, verifyAttemptCount: 1,
  receivedAt: new Date("2026-10-22T09:00:00Z"), publishedAt: new Date("2026-10-22T08:00:00Z"),
  patientIdentifier: null, fhirPayload: null, payloadHash: null, mappingVersion: null,
  retryPhase: null, nextRetryAt: null, leaseUntil: null, leaseToken: null,
  validatedAt: null, mappingStartedAt: null, transformedAt: null, firstSentAt: null,
  targetStoredAt: null, verifiedAt: null, completedAt: null,
};

function wireRow(transaction: ExchangeTransaction, event: boolean, source: boolean, content: boolean): unknown[] {
  const keys = Object.keys(getTableColumns(exchangeTransactions)) as (keyof ExchangeTransaction)[];
  return [...keys.map((key) => transaction[key]), event, source, content];
}

for (const scenario of [
  { name: "matching retry", rows: [wireRow(stored, true, true, true)], kind: "existing" },
  { name: "content mismatch", rows: [wireRow(stored, true, true, false)], kind: "conflict", reason: "content" },
  { name: "event-only collision", rows: [wireRow(stored, true, false, false)], kind: "conflict", reason: "identifiers" },
  { name: "source-only collision", rows: [wireRow(stored, false, true, false)], kind: "conflict", reason: "identifiers" },
  { name: "split identifiers", rows: [wireRow(stored, true, false, false), wireRow({
    ...stored, exchangeId: "00000000-0000-4000-8000-000000000003",
  }, false, true, false)], kind: "conflict", reason: "identifiers" },
  { name: "no business-key winner", rows: [], kind: "error" },
] as const) {
  test(`typed insert outcome: ${scenario.name}`, async (t) => {
    const pool = new Pool();
    const client = Object.assign(new Client(), { release() {} });
    const queries: string[] = [];
    t.mock.method(pool, "connect", async () => client);
    t.mock.method(client, "query", async (query: string | QueryConfig) => {
      const text = typeof query === "string" ? query : query.text;
      queries.push(text);
      return { rows: text.startsWith("select") ? scenario.rows : [] };
    });
    middlewareDatabase.db = drizzle({ client: pool });
    t.after(() => { middlewareDatabase.db = null; });
    if (scenario.kind === "error") {
      await assert.rejects(repository.createExchange(newExchange()), /Exchange UUID collision/);
      assert.equal(queries.at(-1), "rollback");
    } else {
      const result = await repository.createExchange(newExchange());
      assert.equal(result.kind, scenario.kind);
      if (result.kind === "existing") assert.deepEqual(result.transaction, stored);
      if (result.kind === "conflict" && "reason" in scenario) assert.equal(result.reason, scenario.reason);
      assert.equal(queries.at(-1), "commit");
    }
    assert.ok(queries[0].includes("read committed"));
    assert.equal(queries.filter((query) => query.startsWith("insert")).length, 1,
      "A non-created outcome must not append another receipt");
    assert.ok(queries.every((query) => !query.startsWith("update")));
  });
}
