import assert from "node:assert/strict";
import { test } from "node:test";

// Node's test runner isolates test files in separate processes. Never use the
// developer's normal LIS_DATABASE_URL in either test file.
delete process.env.LIS_DATABASE_URL;
const repository = await import("../../src/lis/repository.js");

test("Repository reports an unconfigured LIS connection for every operation", async () => {
  const operations = [
    () => repository.getResultById("synthetic-result"),
    () => repository.listResults(),
    () => repository.getPublishEventByResultId("synthetic-result"),
    () => repository.getPublishEventByEventId("00000000-0000-4000-8000-000000000001"),
    () => repository.withPublishTransaction("synthetic-result", async () => undefined),
    () => repository.createPublishEvent({
      eventId: "00000000-0000-4000-8000-000000000001",
      resultId: "synthetic-result",
      sourceSystem: "lis-repository-test",
      sourceSnapshot: { result_id: "synthetic-result" },
      sourceHash: "a".repeat(64),
      publishedAt: new Date("2026-10-22T09:00:00Z"),
    }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, /LIS_DATABASE_URL is not configured/);
  }
});
