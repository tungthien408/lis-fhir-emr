/** Same JSON semantics as the project contract, kept inside the EMR boundary. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function serialize(current: unknown, depth: number): string {
    if (depth > 64) throw new TypeError("JSON exceeds supported nesting depth");
    if (current === null) return "null";
    if (typeof current === "string") {
      if (/\u0000|[\uD800-\uDFFF]/u.test(current)) throw new TypeError("Unsupported PostgreSQL JSONB text");
      return JSON.stringify(current);
    }
    if (typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("JSON requires finite numbers");
      return JSON.stringify(current);
    }
    if (typeof current !== "object") throw new TypeError("Unsupported JSON value");
    const array = Array.isArray(current);
    if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      throw new TypeError("JSON requires plain objects");
    }
    if (ancestors.has(current) || Object.getOwnPropertySymbols(current).length) throw new TypeError("Unsupported JSON structure");
    ancestors.add(current);
    try {
      const keys = Object.keys(current);
      if (array && keys.length !== current.length) throw new TypeError("JSON requires dense arrays");
      const read = (key: string) => {
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property?.enumerable || !("value" in property)) throw new TypeError("JSON requires data properties");
        return serialize(property.value, depth + 1);
      };
      if (array) return `[${Array.from({ length: current.length }, (_, index) => read(String(index))).join(",")}]`;
      return `{${keys.sort().map((key) => `${serialize(key, depth + 1)}:${read(key)}`).join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }
  return serialize(value, 0);
}
