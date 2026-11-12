/** Supported exchange policy, independently checked against the versioned LIS seed. */
export const TEST_CATALOG_VERSION = "mimic-iv-demo-2.2-v1";
export const SUPPORTED_TEST_UNITS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "50971": Object.freeze(["mEq/L"]),
  "50912": Object.freeze(["mg/dL"]),
  "51222": Object.freeze(["g/dL"]),
  "50802": Object.freeze(["mEq/L"]),
  "51492": Object.freeze(["mg/dL"]),
});

/** Exact matching only: never repair an identifier or convert a clinical quantity. */
export function testUnitIssue(code: string, unit: string): "INVALID_TEST_CODE" | "INVALID_UNIT" | undefined {
  if (!Object.hasOwn(SUPPORTED_TEST_UNITS, code)) return "INVALID_TEST_CODE";
  return SUPPORTED_TEST_UNITS[code]!.includes(unit) ? undefined : "INVALID_UNIT";
}
