import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, hashCanonicalJson } from "../../src/lis/canonical-json.js";

test("canonical JSON sorts keys recursively and ignores insertion order", () => {
  const first = { z: { b: 2, a: 1 }, a: [{ y: true, x: null }, "a b\nc"] };
  const second = { a: [{ x: null, y: true }, "a b\nc"], z: { a: 1, b: 2 } };
  const expected = '{"a":[{"x":null,"y":true},"a b\\nc"],"z":{"a":1,"b":2}}';
  assert.equal(canonicalJson(first), expected);
  assert.equal(canonicalJson(second), expected);
});

test("canonical JSON sorts integer-like keys lexicographically rather than numerically", () => {
  assert.equal(canonicalJson({ "2": "two", "10": "ten", a: "a" }), '{"10":"ten","2":"two","a":"a"}');
});

test("canonical JSON preserves array order", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.notEqual(hashCanonicalJson([1, 2]), hashCanonicalJson([2, 1]));
});

test("number serialization uses JSON decimal notation, normalizes -0 and keeps exponents deterministic", () => {
  assert.equal(canonicalJson([-0, 3.4, 1e-7, 1e21]), "[0,3.4,1e-7,1e+21]");
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalJson({ value }), /finite numbers/);
  }
});

test("UTC timestamp strings keep all fractional digits during canonical serialization", () => {
  assert.equal(canonicalJson({ effective_at: "2026-10-22T08:00:00.123456Z" }),
    '{"effective_at":"2026-10-22T08:00:00.123456Z"}');
});

test("SHA-256 matches a fixed canonical JSON test vector and is independent of key order", () => {
  const expected = "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777";
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(hashCanonicalJson({ b: 2, a: 1 }), expected);
  assert.equal(hashCanonicalJson({ a: 1, b: 2 }), expected);
  assert.notEqual(hashCanonicalJson({ a: 1, b: 3 }), expected);
});
