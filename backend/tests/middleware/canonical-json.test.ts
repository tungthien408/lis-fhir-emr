import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJson, hashCanonicalJson } from "../../src/middleware/canonical-json.js";
import { canonicalJson as lisCanonicalJson, hashCanonicalJson as lisHash } from "../../src/lis/canonical-json.js";
import type { JsonValue } from "../../src/lis/repository.js";

const golden: { fixtures: { name: string; input: JsonValue; canonical: string; sha256: string }[] } = JSON.parse(
  readFileSync(new URL("./fixtures/lis-a2-golden.json", import.meta.url), "utf8"),
);

for (const fixture of golden.fixtures) {
  test(`canonical/hash matches frozen actual-LIS golden fixture: ${fixture.name}`, () => {
    assert.equal(lisCanonicalJson(fixture.input), fixture.canonical);
    assert.equal(lisHash(fixture.input), fixture.sha256);
    assert.equal(canonicalJson(fixture.input), fixture.canonical);
    assert.equal(hashCanonicalJson(fixture.input), fixture.sha256);
  });
}

test("key insertion order is ignored recursively; array order is retained", () => {
  assert.equal(hashCanonicalJson({ z: { b: 2, a: 1 }, a: [true, null] }),
    hashCanonicalJson({ a: [true, null], z: { a: 1, b: 2 } }));
  assert.notEqual(hashCanonicalJson([1, 2]), hashCanonicalJson([2, 1]));
  assert.equal(canonicalJson({ "2": 2, "10": 10 }), '{"10":10,"2":2}');
  assert.equal(canonicalJson(-0), "0");
  assert.equal(canonicalJson("\u0000\ud800"), lisCanonicalJson("\u0000\ud800"), "String escaping is exactly JSON.stringify");
});

test("non-JSON and nonfinite values are rejected instead of silently dropping or changing them", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let getterCalled = false;
  const accessor = { get value() { getterCalled = true; return 1; } };
  for (const value of [
    undefined, NaN, Infinity, -Infinity, 1n, Symbol("test"), () => 1,
    { missing: undefined }, [undefined], new Array(2), new Date(), new Map(), new Set(),
    { value: Infinity }, cyclic, accessor, { [Symbol("key")]: 1 },
  ]) assert.throws(() => canonicalJson(value), TypeError);
  assert.equal(getterCalled, false);
  const shared = { a: 1 };
  assert.equal(canonicalJson([shared, shared]), '[{"a":1},{"a":1}]', "Shared non-cyclic objects are valid");
});
