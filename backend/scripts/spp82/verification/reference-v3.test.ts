import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadExpected } from "./expected-loader.js";

const reference = (version: string) => new URL(`../reference/spp65-${version}/`, import.meta.url);
const load = (version: string) => loadExpected(fileURLToPath(new URL("manifest.json", reference(version))),
  readFileSync(new URL("manifest.sha256", reference(version)), "utf8").trim());

test("v2 remains loadable; v3 preserves all 1000 independent clinical answers", () => {
  const old = load("v2"); const current = load("v3");
  assert.deepEqual(current.results, old.results);
  assert.deepEqual(current.patient_links.map(({ identifier_system: _system, ...link }) => link),
    old.patient_links.map(({ identifier_system: _system, ...link }) => link));
  assert.equal(current.rules.version, "spp82-independent-mr01-mr09-v2");
  assert.notEqual(current.rules.result_system, old.rules.result_system);
});

test("v3 freeze is reproducible and rechecks every answer against raw MIMIC", () => {
  const directory = mkdtempSync(join(tmpdir(), "lis-reference-v3-test-"));
  try {
    const output = join(directory, "reference");
    const result = spawnSync("python3", [fileURLToPath(new URL("freeze-reference-v3.py", import.meta.url)), "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const name of readdirSync(reference("v3"))) assert.deepEqual(readFileSync(join(output, name)), readFileSync(new URL(name, reference("v3"))), name);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
