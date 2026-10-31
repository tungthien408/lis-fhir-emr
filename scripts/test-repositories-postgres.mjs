/** Run Repository tests in a NEW PostgreSQL 17 container, never Compose. */
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const name = `spp66-repository-test-${randomUUID()}`;
const isolationToken = randomUUID();
const passwords = Object.fromEntries(["admin", "lis", "middleware", "emr"].map((role) => [role, randomBytes(24).toString("hex")]));
const evidencePath = join(tmpdir(), `${name}-c4.json`);
const e2eEvidencePath = join(tmpdir(), `${name}-d3.json`);
const backend = fileURLToPath(new URL("../backend/", import.meta.url));
const dockerEnv = { ...process.env };
dockerEnv.POSTGRES_PASSWORD = passwords.admin;
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
  delete dockerEnv[key];
}
function docker(args, input) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    encoding: "utf8", env: dockerEnv, input,
  });
  if (result.error || result.status !== 0) {
    let message = result.error?.message ?? result.stderr.trim() ?? "Docker command failed";
    for (const password of Object.values(passwords)) message = message.replaceAll(password, "[redacted]");
    throw new Error(message);
  }
  return result.stdout.trim();
}

let started = false;
try {
  // --pull=never prevents unexpected network access; no project volume mounts.
  docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_DB=dacn_db", "-e", "POSTGRES_PASSWORD", "postgres:17"]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "dacn_db"]);
      ready = true; break;
    } catch {
      await setTimeout(250);
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  for (const file of ["dacn_db_init_v2.sql", "access_roles.sql"]) {
    docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "dacn_db", "-v", "ON_ERROR_STOP=1"],
      readFileSync(new URL(`../database/${file}`, import.meta.url), "utf8"));
  }
  docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "dacn_db", "-v", "ON_ERROR_STOP=1"],
    // Generated hex secrets are passed on stdin, never printed or stored in the repo.
    `ALTER ROLE lis_app PASSWORD '${passwords.lis}';\nALTER ROLE integration_app PASSWORD '${passwords.middleware}';\nALTER ROLE emr_app PASSWORD '${passwords.emr}';\nCOMMENT ON DATABASE dacn_db IS 'spp66-disposable:${isolationToken}';\n`);
  const port = docker(["port", name, "5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error("Unable to determine disposable PostgreSQL port");
  const env = {
    ...process.env,
    LIS_REPOSITORY_TEST_DATABASE_URL: `postgresql://lis_app:${passwords.lis}@127.0.0.1:${port}/dacn_db`,
    LIS_REPOSITORY_TEST_DISPOSABLE_TOKEN: isolationToken,
    MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL: `postgresql://integration_app:${passwords.middleware}@127.0.0.1:${port}/dacn_db`,
    EMR_REPOSITORY_TEST_DATABASE_URL: `postgresql://emr_app:${passwords.emr}@127.0.0.1:${port}/dacn_db`,
    EMR_REPOSITORY_TEST_DISPOSABLE: "1",
    C4_DATABASE_ISOLATION_TOKEN: isolationToken,
    C4_EVIDENCE_PATH: evidencePath,
    D3_DATABASE_ISOLATION_TOKEN: isolationToken,
    D3_EVIDENCE_PATH: e2eEvidencePath,
  };
  const suites = process.argv.includes("--emr-only")
    ? [["run", "test:emr"]]
    : process.argv.includes("--lis-dispatch-only") ? [["run", "test:lis-dispatch"]]
    : process.argv.includes("--real-emr-only") ? [["run", "test:integration"]]
    : process.argv.includes("--e2e-only") ? [["run", "test:e2e"]]
    : [["test"], ["run", "test:middleware"], ["run", "test:emr"], ["run", "test:integration"], ["run", "test:e2e"]];
  for (const args of suites) {
    const result = spawnSync("npm", args, { cwd: backend, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
  if (suites.some((args) => args.includes("test:integration"))) {
    // A test runner that silently skips/doesn't execute C4 cannot report success.
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    if (evidence.completed !== true || evidence.scenarios.length === 0) throw new Error("C4 evidence is incomplete");
    console.log(`C4 synthetic evidence: ${evidencePath}`);
  }
  if (suites.some((args) => args.includes("test:e2e"))) {
    const evidence = JSON.parse(readFileSync(e2eEvidencePath, "utf8"));
    const cases = new Set(evidence.scenarios?.filter((scenario) => scenario.outcome === "PASS").map((scenario) => scenario.case_id));
    if (evidence.completed !== true || evidence.environment?.cleanup_empty !== true
      || Array.from({ length: 10 }, (_, index) => `D3-${String(index + 1).padStart(2, "0")}`).some((id) => !cases.has(id))) {
      throw new Error("D3 evidence is incomplete; every mandatory case must actually execute");
    }
    console.log(`D3 synthetic evidence: ${e2eEvidencePath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Repository test setup failed");
  process.exitCode = 1;
} finally {
  if (started) docker(["stop", name]);
}
