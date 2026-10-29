import assert from "node:assert/strict";
import { test } from "node:test";
import type { NewExchange } from "../../src/middleware/repository.js";
import { acceptExchange } from "../../src/middleware/service.js";
import { rehash, syntheticTransaction, validEnvelope } from "./service-fixtures.js";

async function rejectBeforeWrite(input: unknown, kind: "malformed" | "invalid", field?: string, code?: string) {
  let writes = 0;
  const outcome = await acceptExchange(input, {
    async createExchange() { writes++; throw new Error("Validation must precede persistence"); },
  });
  assert.equal(writes, 0);
  assert.ok(outcome.kind === kind);
  if (field) assert.equal(outcome.error.field, field);
  if (code) assert.equal(outcome.error.code, code);
}

test("valid request yields only stored receipt acknowledgement fields plus typed metadata", async () => {
  const input = validEnvelope();
  input.event_id = input.event_id.toUpperCase();
  const row = syntheticTransaction(input);
  const result = await acceptExchange(input, {
    async createExchange(prepared) {
      assert.deepEqual(prepared.sourceEnvelope, input);
      assert.notEqual(prepared.sourceEnvelope, input);
      return { kind: "created", transaction: row };
    },
  });
  assert.deepEqual(result, {
    kind: "accepted", created: true, accepted: true, event_id: input.event_id,
    exchange_id: row.exchangeId, source_system: input.source_system,
    source_result_id: input.source_result_id, source_hash: input.source_hash,
  });
  assert.equal("status" in result, false);
});

test("all required envelope and snapshot fields must be present with the right JSON type", async (t) => {
  for (const key of Object.keys(validEnvelope())) {
    await t.test(`missing envelope ${key}`, async () => {
      const input: Record<string, unknown> = validEnvelope(); delete input[key];
      await rejectBeforeWrite(input, "malformed", key);
    });
  }
  for (const key of Object.keys(validEnvelope().source_snapshot)) {
    await t.test(`missing snapshot ${key}`, async () => {
      const input = validEnvelope(); delete input.source_snapshot[key];
      await rejectBeforeWrite(input, "malformed", `source_snapshot.${key}`);
    });
  }
  for (const [field, value] of [
    ["event_id", 1], ["source_system", false], ["source_result_id", null],
    ["source_hash", []], ["published_at", 1], ["source_snapshot", []],
  ] as const) {
    await rejectBeforeWrite({ ...validEnvelope(), [field]: value }, "malformed", field);
  }
  for (const [field, value] of [
    ["patient_id", 1], ["test_code", null], ["unit", false], ["value_num", "3.4"],
    ["reference_low", "1.2"], ["reference_high", false], ["fluid", {}], ["category", []],
    ["effective_at", 1], ["result_status", null],
  ] as const) {
    const input = validEnvelope();
    const snapshot: Record<string, unknown> = input.source_snapshot;
    snapshot[field] = value;
    await rejectBeforeWrite(input, "malformed", `source_snapshot.${field}`);
  }
});

test("bad request bodies and unsupported JSON never reach the Repository", async () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [undefined, null, true, 5, "{}", [], new Date(), cycle]) {
    await rejectBeforeWrite(value, "malformed", "body");
  }
  for (const value of [NaN, Infinity, -Infinity, undefined, 1n, () => 1, new Date(), "\u0000", "\ud800", "\udc00"]) {
    await rejectBeforeWrite({ ...validEnvelope(), extra: value }, "malformed", "body");
  }
  await rejectBeforeWrite({ ...validEnvelope(), ["\u0000"]: true }, "malformed", "body");
});

test("UUID, source identity and lowercase SHA-256 format are checked", async () => {
  for (const event_id of ["", "not-a-uuid", "00000000000040008000000000000001", " 00000000-0000-4000-8000-000000000001"]) {
    await rejectBeforeWrite({ ...validEnvelope(), event_id }, "malformed", "event_id");
  }
  for (const field of ["source_system", "source_result_id"]) {
    await rejectBeforeWrite({ ...validEnvelope(), [field]: " \t " }, "malformed", field);
  }
  for (const source_hash of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)]) {
    await rejectBeforeWrite({ ...validEnvelope(), source_hash }, "malformed", "source_hash");
  }
});

test("real calendar dates, timezones and finite timestamp ranges are required", async () => {
  for (const value of [
    "2026-02-29T12:00:00Z", "2100-02-29T12:00:00Z", "2026-04-31T12:00:00Z",
    "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-00T00:00:00Z",
    "2026-10-22", "2026-10-22T09:00:00", "2026-10-22T24:00:00Z", "2026-10-22T09:60:00Z",
    "2026-10-22T09:00:60Z", "2026-10-22T09:00:00+16:00", "2026-10-22T09:00:00+07:60",
    "0000-01-01T00:00:00Z", "0001-01-01T00:00:00+07:00", "10000-01-01T00:00:00Z",
    "infinity", "2026-10-22T09:00:00Z ",
  ]) {
    await rejectBeforeWrite({ ...validEnvelope(), published_at: value }, "malformed", "published_at");
    const input = validEnvelope(); input.source_snapshot.effective_at = value;
    await rejectBeforeWrite(input, "malformed", "source_snapshot.effective_at");
  }
});

test("FINAL, clinical identifiers, nonblank unit, reference range and result identity are validated", async () => {
  for (const status of ["READY", "final", ""]) {
    const input = validEnvelope();
    const snapshot: Record<string, unknown> = input.source_snapshot;
    snapshot.result_status = status;
    await rejectBeforeWrite(input, "invalid", "source_snapshot.result_status", "RESULT_NOT_READY");
  }
  for (const field of ["result_id", "patient_id", "test_code", "test_name", "unit"]) {
    const input = validEnvelope(); input.source_snapshot[field] = "  ";
    await rejectBeforeWrite(input, "invalid", `source_snapshot.${field}`);
  }
  await rejectBeforeWrite({ ...validEnvelope(), source_result_id: "another-result" }, "invalid", "source_result_id");
  const input = validEnvelope(); input.source_snapshot.reference_low = 9; input.source_snapshot.reference_high = 1;
  await rejectBeforeWrite(input, "invalid", "source_snapshot.reference_low");
});

test("snapshot tampering, hash-of-envelope and hash-of-hash are rejected before writes", async () => {
  const input = validEnvelope(); input.source_snapshot.value_num = 9;
  await rejectBeforeWrite(input, "invalid", "source_hash");
  const { hashCanonicalJson } = await import("../../src/lis/canonical-json.js");
  for (const hashOf of [validEnvelope(), validEnvelope().source_hash]) {
    await rejectBeforeWrite({ ...validEnvelope(), source_hash: hashCanonicalJson(hashOf) }, "invalid", "source_hash");
  }
});

test("finite numeric edges, nullable bounds and valid timestamps are preserved without coercion", async () => {
  for (const value of [-0, -2.5, Number.MIN_VALUE, Number.MAX_VALUE, 1e-7, 1e21]) {
    const input = validEnvelope();
    input.source_snapshot.value_num = value;
    input.source_snapshot.reference_low = null; input.source_snapshot.reference_high = null;
    input.source_snapshot.fluid = null; input.source_snapshot.category = null;
    input.source_snapshot.effective_at = "0004-02-29T00:00:00.000001Z";
    input.published_at = "2026-10-22T16:00:00.123456+07:00";
    rehash(input);
    const result = await acceptExchange(input, {
      async createExchange(prepared) {
        assert.equal(prepared.sourceEnvelope.source_snapshot.value_num, Object.is(value, -0) ? 0 : value);
        assert.equal(prepared.sourceEnvelope.published_at, input.published_at);
        assert.equal(prepared.sourceEnvelope.source_snapshot.effective_at, input.source_snapshot.effective_at);
        return { kind: "created", transaction: syntheticTransaction(prepared.sourceEnvelope) };
      },
    });
    assert.equal(result.kind, "accepted");
  }
});

test("extra JSON fields are retained and snapshot extras participate in hashing", async () => {
  const input = validEnvelope(); input.extra = { synthetic: true };
  input.source_snapshot.extra = { "2": [3, 1], "10": "Tiếng Việt 😀" };
  await rejectBeforeWrite(input, "invalid", "source_hash");
  rehash(input);
  const result = await acceptExchange(input, {
    async createExchange(prepared) {
      assert.deepEqual(prepared.sourceEnvelope, input);
      return { kind: "created", transaction: syntheticTransaction(input) };
    },
  });
  assert.equal(result.kind, "accepted");
});

test("typed B1 existing/conflict outcomes become acknowledgement or DUPLICATE_CONFLICT", async () => {
  const input = validEnvelope(); const transaction = syntheticTransaction(input); transaction.status = "FAILED";
  const existing = await acceptExchange(input, { async createExchange() { return { kind: "existing", transaction }; } });
  assert.ok(existing.kind === "accepted"); assert.equal(existing.created, false);
  assert.equal(existing.exchange_id, transaction.exchangeId);
  for (const reason of ["identifiers", "content"] as const) {
    const result = await acceptExchange(input, { async createExchange() {
      return { kind: "conflict", reason, byEventId: transaction, bySourceResult: undefined };
    } });
    assert.ok(result.kind === "conflict"); assert.equal(result.error.code, "DUPLICATE_CONFLICT");
  }
  assert.equal(transaction.status, "FAILED");
});

test("caller mutation during persistence cannot change the validated request or acknowledgement", async () => {
  const input = validEnvelope(); const original = structuredClone(input);
  let captured: NewExchange | undefined;
  const pending = acceptExchange(input, { async createExchange(prepared) {
    captured = prepared;
    await Promise.resolve();
    return { kind: "created", transaction: syntheticTransaction(prepared.sourceEnvelope) };
  } });
  input.source_system = "mutated"; input.source_snapshot.value_num = 9;
  const result = await pending;
  assert.deepEqual(captured?.sourceEnvelope, original);
  assert.ok(result.kind === "accepted"); assert.equal(result.source_system, original.source_system);
});

test("database failures never become acceptance and reveal no driver detail", async () => {
  const result = await acceptExchange(validEnvelope(), { async createExchange() {
    throw new Error("SQL with synthetic payload and a secret database URL");
  } });
  assert.deepEqual(result, { kind: "unavailable", error: {
    code: "DEPENDENCY_UNAVAILABLE", message: "Exchange persistence is temporarily unavailable",
  } });
});

