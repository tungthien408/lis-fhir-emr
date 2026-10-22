import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Chỉ kiểm tra cấu trúc file SQL tĩnh, KHÔNG thay thế việc import trên PostgreSQL.
const sql = readFileSync(new URL("../database/dacn_db_init_v2.sql", import.meta.url), "utf8");
const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(lis|integration|emr)\.([a-z_]+)\s*\(/g)]
  .map((match) => `${match[1]}.${match[2]}`);
const bySchema = Object.fromEntries(["lis", "integration", "emr"].map((name) => [
  name,
  tables.filter((table) => table.startsWith(`${name}.`)).length,
]));
assert.deepEqual(bySchema, { lis: 5, integration: 5, emr: 3 });
assert.match(sql, /CONSTRAINT exchange_completed_chk CHECK\s*\(\s*\(\s*status\s*=\s*'DELIVERED'\s*AND verified_at IS NOT NULL\s*AND completed_at IS NOT NULL/s);
assert.match(sql, /status\s*<>\s*'DELIVERED'\s*AND completed_at IS NULL/s);
console.log("PASS: SQL co 3 schema, 13 bang, va constraint DELIVERED hai chieu.");
console.log("Chu y: Chua thuc thi SQL tren PostgreSQL.");
