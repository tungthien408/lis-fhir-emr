import assert from "node:assert/strict";
import { test } from "node:test";
import { storeObservation } from "../../src/emr/service.js";
import { validObservation } from "./service-fixtures.js";

test("catalog regression: unknown code and consistent unsupported units never reach patient lookup", async () => {
  for (const mode of ["unknown-code", "all-kg", "kg-without-range"] as const) {
    const input = validObservation();
    input.code.coding[0].code = mode === "unknown-code" ? "99999" : "50912";
    input.valueQuantity.unit = mode === "unknown-code" ? "mg/dL" : "kg";
    for (const range of input.referenceRange ?? []) for (const key of ["low", "high"] as const) {
      if (range[key]) range[key].unit = input.valueQuantity.unit;
    }
    if (mode === "kg-without-range") delete input.referenceRange;
    let lookups = 0;
    const result = await storeObservation(input, { async withPatientLinkTransaction() { lookups++; throw new Error("must not lookup"); } });
    assert.equal(result.kind, "invalid", mode);
    if (result.kind === "invalid") assert.equal(result.error.field, mode === "unknown-code" ? "code.coding[0].code" : "valueQuantity.unit");
    assert.equal(lookups, 0, mode);
  }
});
