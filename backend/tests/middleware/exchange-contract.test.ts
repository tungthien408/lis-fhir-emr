import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_TEST_UNITS, TEST_CATALOG_VERSION, testUnitIssue } from "../../src/common/test-catalog.js";
import { FHIR_NAMESPACES } from "../../src/common/fhir-namespaces.js";

test("exchange contract matches the versioned seed catalog, patient links and frontend constants", () => {
  const seed = readFileSync(new URL("../../../database/seed/01_reference_data.sql", import.meta.url), "utf8");
  const block = /INSERT INTO lis\.test_catalog[^;]+;/s.exec(seed)![0];
  const actual: Record<string, string[]> = {};
  for (const row of block.matchAll(/\('([0-9]+)',[^\n]+?'(\[[^']+\])'::jsonb, '([^']+)'\)/g)) {
    actual[row[1]!] = JSON.parse(row[2]!); assert.equal(row[3], TEST_CATALOG_VERSION);
  }
  assert.deepEqual(actual, SUPPORTED_TEST_UNITS);
  const links = /INSERT INTO emr\.patient_links[^;]+;/s.exec(seed)![0];
  const systems = [...links.matchAll(/\('([^']+)',/g)].map((row) => row[1]);
  assert.equal(systems.length, 100); assert.deepEqual([...new Set(systems)], [FHIR_NAMESPACES.patient]);
  const frontend = readFileSync(new URL("../../../frontend/apps/emr/src/types/emr.ts", import.meta.url), "utf8");
  assert.ok(frontend.includes(`PATIENT_SYSTEM = '${FHIR_NAMESPACES.patient}'`));
  assert.ok(frontend.includes(`RESULT_SYSTEM = '${FHIR_NAMESPACES.result}'`));
});

test("catalog matching never accepts inherited keys, whitespace or case conversion", () => {
  for (const code of ["__proto__", "constructor", " 50912", "50912 "]) assert.equal(testUnitIssue(code, "mg/dL"), "INVALID_TEST_CODE");
  for (const unit of [" mg/dL", "mg/dL ", "MG/DL", "kg"]) assert.equal(testUnitIssue("50912", unit), "INVALID_UNIT");
});
