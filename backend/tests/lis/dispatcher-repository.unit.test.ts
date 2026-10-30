import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type QueryConfig } from "pg";
import type { DispatchAcknowledgement, DispatchLease } from "../../src/lis/repository.js";

delete process.env.LIS_DATABASE_URL;
const repository = await import("../../src/lis/repository.js");
const { lisDatabase } = await import("../../src/lis/db.js");
const eventId = "00000000-0000-4000-8000-000000000001";
const token = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const lease: DispatchLease = { eventId, leaseToken: token };
const ack: DispatchAcknowledgement = { accepted: true, event_id: eventId,
  exchange_id: "00000000-0000-4000-8000-000000000004", source_system: "d1-synthetic-lis",
  source_result_id: "D1-SYNTHETIC-R", source_hash: "a".repeat(64) };

test("D1: an unconfigured database rejects every operation instead of pretending the lease is stale", async () => {
  for (const operation of [
    () => repository.claimPublishEvent(1000),
    () => repository.beginDispatchAttempt(lease, 1000, 4),
    () => repository.markDispatchAttemptSent(lease, attemptId),
    () => repository.finishDispatchAttempt(lease, attemptId, { kind: "ack", httpStatus: 202, acknowledgement: ack }),
    () => repository.getDispatchAttempts(eventId),
  ]) await assert.rejects(operation, /LIS_DATABASE_URL is not configured/);
});

test("D1: invalid lease/retry/attempt bounds fail before database access", async () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 3600001]) {
    await assert.rejects(repository.claimPublishEvent(value), RangeError);
    await assert.rejects(repository.beginDispatchAttempt(lease, value, 4), RangeError);
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, 101]) {
    await assert.rejects(repository.beginDispatchAttempt(lease, 1000, value), RangeError);
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, 86400001]) {
    await assert.rejects(repository.finishDispatchAttempt(lease, attemptId,
      { kind: "retry", code: "NETWORK_ERROR", delayMs: value }), RangeError);
  }
  await assert.rejects(repository.beginDispatchAttempt({ ...lease, leaseToken: "invalid" }, 1000, 4), TypeError);
  await assert.rejects(repository.markDispatchAttemptSent({ ...lease, eventId: "invalid" }, attemptId), TypeError);
  for (const value of [0, 600, 202.5, NaN]) {
    await assert.rejects(repository.finishDispatchAttempt(lease, attemptId,
      { kind: "retry", code: "HTTP_TEMPORARY", delayMs: 100, httpStatus: value }), RangeError);
  }
});

// Stub only pg's wire boundary; real Drizzle must propagate failures and issue ROLLBACK.
for (const phase of ["select", "abandon", "claim", "commit"] as const) {
  test(`D1: ${phase} database failure propagates and rolls back the claim`, async (t) => {
    const pool = new Pool(); const client = Object.assign(new Client(), { release() {} });
    const failure = new Error("Synthetic database failure"); const queries: string[] = [];
    t.mock.method(pool, "connect", async () => client);
    t.mock.method(client, "query", async (query: string | QueryConfig) => {
      const text = typeof query === "string" ? query : query.text; queries.push(text);
      if ((phase === "select" && text.startsWith("select")) || (phase === "commit" && text === "commit")
        || (phase === "abandon" && text.startsWith('update "lis"."dispatch_attempts"'))
        || (phase === "claim" && text.startsWith('update "lis"."publish_events"'))) throw failure;
      return { rows: text.startsWith("select") || text.startsWith('update "lis"."publish_events"') ? [[
        eventId, ack.source_result_id, ack.source_system, { synthetic: true }, ack.source_hash,
        "2026-10-30T00:00:00Z", null, "IN_FLIGHT", 0, null, "2026-10-30T00:01:00Z", null, token, null, null, null,
      ]] : [] };
    });
    lisDatabase.db = drizzle({ client: pool });
    t.after(async () => { lisDatabase.db = null; await pool.end(); });
    await assert.rejects(repository.claimPublishEvent(1000), (error: unknown) =>
      error === failure || (error instanceof Error && error.cause === failure));
    assert.match(queries[0], /read committed/); assert.equal(queries.at(-1), "rollback");
    assert.ok(queries.every((query) => !/"integration"|"emr"/.test(query)));
  });
}
