import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptExchange, validateExchangeEnvelope } from "../../src/middleware/service.js";
import { rehash, validEnvelope } from "./service-fixtures.js";

test("catalog regression: unknown code and wrong unit never reach exchange persistence", async () => {
  for (const [code, unit, expected] of [["99999", "mg/dL", "INVALID_TEST_CODE"], ["50912", "kg", "INVALID_UNIT"]]) {
    const input = validEnvelope();
    input.source_snapshot.test_code = code!; input.source_snapshot.unit = unit!; rehash(input);
    let writes = 0;
    const result = await acceptExchange(input, { async createExchange() { writes++; throw new Error("must not persist"); } });
    assert.equal(result.kind, "invalid");
    if (result.kind === "invalid") assert.equal(result.error.code, expected);
    assert.equal(writes, 0);
  }
});

test("catalog regression: all supported pairs preserve the validated source exactly", () => {
  for (const [code, unit] of [["50971", "mEq/L"], ["50912", "mg/dL"], ["51222", "g/dL"], ["50802", "mEq/L"], ["51492", "mg/dL"]]) {
    const input = validEnvelope(); input.source_snapshot.test_code = code!; input.source_snapshot.unit = unit!; rehash(input);
    const result = validateExchangeEnvelope(input);
    assert.equal(result.kind, "valid");
    if (result.kind === "valid") assert.deepEqual(result.envelope, input);
  }
});
