import { createHash } from "node:crypto";
import type { JsonValue } from "./repository.js";

/**
 * Contract serialization: recursive UTF-16 lexicographic object-key ordering,
 * original array order, no whitespace; JSON.stringify for strings and finite
 * JS numbers (including -0 -> 0). Timestamps are already normalized UTC strings.
 * Build object text directly: JSON.stringify on a sorted object reorders integer keys.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Canonical JSON requires finite numbers");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  throw new TypeError("Unsupported canonical JSON value");
}

export function hashCanonicalJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
