import { createHash } from "node:crypto";

/**
 * LIS A2-compatible JSON: default JS lexicographic key sort, original array
 * order, JSON.stringify strings/finite numbers, no whitespace, SHA-256 UTF-8.
 * Build object text directly: JSON.stringify would reorder integer-like keys.
 * Accept unknown at this boundary so unsupported values cannot be hashed as
 * valid input. Dates, accessors, sparse arrays and cycles are not JSON data.
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function serialize(current: unknown): string {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("Canonical JSON requires finite numbers");
      return JSON.stringify(current);
    }
    if (typeof current !== "object") throw new TypeError("Unsupported canonical JSON value");
    if (ancestors.has(current)) throw new TypeError("Canonical JSON cannot contain cycles");
    const array = Array.isArray(current);
    if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      throw new TypeError("Canonical JSON requires plain objects");
    }
    if (Object.getOwnPropertySymbols(current).length) throw new TypeError("Unsupported canonical JSON key");
    ancestors.add(current);
    try {
      const keys = Object.keys(current);
      if (array && keys.length !== current.length) throw new TypeError("Canonical JSON requires dense arrays");
      const read = (key: string): string => {
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property?.enumerable || !("value" in property)) {
          throw new TypeError("Canonical JSON requires data properties");
        }
        return serialize(property.value);
      };
      if (array) return `[${Array.from({ length: current.length }, (_, index) => read(String(index))).join(",")}]`;
      return `{${keys.sort().map((key) => `${JSON.stringify(key)}:${read(key)}`).join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }
  return serialize(value);
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
