/** Run LIS regressions + B1 tests in a NEW PostgreSQL 17 container, never Compose. */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const name = `spp66-repository-test-${randomUUID()}`;
const backend = fileURLToPath(new URL("../backend/", import.meta.url));
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
  delete dockerEnv[key];
}
function docker(args, input) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    encoding: "utf8", env: dockerEnv, input,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? "Docker command failed");
  }
  return result.stdout.trim();
}

let started = false;
try {
  // --pull=never prevents unexpected network access; no project volume mounts.
  docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_DB=dacn_db", "-e", "POSTGRES_PASSWORD=b1-disposable-admin", "postgres:17"]);
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
    "ALTER ROLE lis_app PASSWORD 'b1-disposable-lis';\nALTER ROLE integration_app PASSWORD 'b1-disposable-integration';\n");
  const port = docker(["port", name, "5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error("Unable to determine disposable PostgreSQL port");
  const env = {
    ...process.env,
    LIS_REPOSITORY_TEST_DATABASE_URL: `postgresql://lis_app:b1-disposable-lis@127.0.0.1:${port}/dacn_db`,
    MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL: `postgresql://integration_app:b1-disposable-integration@127.0.0.1:${port}/dacn_db`,
  };
  for (const args of [["test"], ["run", "test:middleware"]]) {
    const result = spawnSync("npm", args, { cwd: backend, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Repository test setup failed");
  process.exitCode = 1;
} finally {
  if (started) docker(["stop", name]);
}
