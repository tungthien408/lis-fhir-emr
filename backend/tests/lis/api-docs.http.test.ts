/** Swagger UI và mô tả API phải mở được mà không cần database. */
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { OpenAPIV3 } from "openapi-types";
import { registerLisApiDocs } from "../../src/lis/api-docs.js";
import { lisOpenApiDocument } from "../../src/lis/openapi.js";
import { isRecord, requestJson, startHttpServer } from "./http-test-helpers.js";

delete process.env.LIS_DATABASE_URL;
const { registerLisRoutes } = await import("../../src/lis/controller.js");

function schema(name: string): OpenAPIV3.SchemaObject {
  const value = lisOpenApiDocument.components?.schemas?.[name];
  assert.ok(value && !("$ref" in value));
  return value;
}

function queryParameter(name: string): OpenAPIV3.ParameterObject {
  const value = lisOpenApiDocument.paths["/api/results"]?.get?.parameters
    ?.find((parameter) => !("$ref" in parameter) && parameter.name === name);
  assert.ok(value && !("$ref" in value));
  return value;
}

function checkReferences(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) checkReferences(child);
  } else if (isRecord(value)) {
    if ("$ref" in value) {
      assert.equal(typeof value.$ref, "string");
      assert.ok(typeof value.$ref === "string" && value.$ref.startsWith("#/"));
      let target: unknown = lisOpenApiDocument;
      for (const part of value.$ref.slice(2).split("/")) {
        assert.ok(isRecord(target) && Object.hasOwn(target, part));
        target = target[part];
      }
      assert.notEqual(target, undefined);
    }
    for (const child of Object.values(value)) checkReferences(child);
  }
}

test("LIS Swagger UI (HTTP)", async (t) => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerLisRoutes(app);
  registerLisApiDocs(app);
  const server = await startHttpServer(app);
  t.after(server.close);

  await t.test("the docs URL without a trailing slash redirects to the working asset base", async () => {
    const response = await fetch(`${server.baseUrl}/docs/api`, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), "/docs/api/");
    await response.text();
  });

  await t.test("the Swagger page is available without database configuration", async () => {
    const response = await fetch(`${server.baseUrl}/docs/api/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /LIS — Thử API/);
    assert.match(html, /id="swagger-ui"/);
    assert.match(html, /\.\/swagger-ui-bundle\.js/);
    assert.match(html, /\.\/swagger-ui\.css/);
    assert.doesNotMatch(html, /https?:\/\/[^"'\s]+\.(?:js|css)/);
  });

  await t.test("JavaScript, CSS and presets are served locally", async () => {
    for (const [asset, contentType] of [
      ["swagger-ui.css", /text\/css/],
      ["swagger-ui-bundle.js", /javascript/],
      ["swagger-ui-standalone-preset.js", /javascript/],
    ] as const) {
      const response = await fetch(`${server.baseUrl}/docs/api/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", contentType);
      assert.ok((await response.text()).length > 1000);
    }
  });

  await t.test("OpenAPI JSON describes only the seven implemented LIS routes and uses the current origin", async () => {
    const response = await requestJson(server.baseUrl, "/docs/api/openapi.json");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, lisOpenApiDocument);
    assert.deepEqual(Object.keys(lisOpenApiDocument.paths).sort(), [
      "/api/publish-events/{eventId}", "/api/results", "/api/results/{resultId}",
      "/api/results/{resultId}/publish", "/api/results/{resultId}/publish-event", "/health", "/ready",
    ]);
    assert.equal(lisOpenApiDocument.openapi, "3.0.3");
    assert.equal(lisOpenApiDocument.servers?.[0]?.url, "/");
  });

  await t.test("parameters and response types match the LIS contract", () => {
    const limit = queryParameter("limit").schema;
    const offset = queryParameter("offset").schema;
    assert.ok(limit && !("$ref" in limit));
    assert.ok(offset && !("$ref" in offset));
    assert.equal(limit.default, 20);
    assert.equal(limit.minimum, 1);
    assert.equal(limit.maximum, 100);
    assert.equal(offset.default, 0);
    assert.equal(offset.maximum, Number.MAX_SAFE_INTEGER);
    const numeric = schema("LabResult").properties?.value_num;
    assert.ok(numeric && !("$ref" in numeric));
    assert.equal(numeric.type, "string");
    const publish = lisOpenApiDocument.paths["/api/results/{resultId}/publish"]?.post;
    assert.ok(publish);
    assert.equal(publish.requestBody, undefined);
    assert.deepEqual(Object.keys(publish.responses).sort(), ["200", "202", "400", "404", "409", "413", "415", "422", "503"]);
    assert.deepEqual(schema("PublishResult").required?.slice().sort(), ["dispatch_status", "event_id", "exchange_id", "result_id"]);
  });

  await t.test("all schema references resolve and operation IDs are unique", () => {
    checkReferences(lisOpenApiDocument);
    const ids: string[] = [];
    for (const path of Object.values(lisOpenApiDocument.paths)) {
      for (const operation of [path?.get, path?.post]) {
        if (operation) {
          assert.ok(operation.operationId);
          ids.push(operation.operationId);
        }
      }
    }
    assert.equal(ids.length, 7);
    assert.equal(new Set(ids).size, 7);
  });

  await t.test("UI loads the local specification and enables GET/POST without an external validator", async () => {
    const response = await fetch(`${server.baseUrl}/docs/api/swagger-ui-init.js`);
    assert.equal(response.status, 200);
    const script = await response.text();
    assert.match(script, /"url": "\/docs\/api\/openapi\.json"/);
    assert.match(script, /"validatorUrl": null/);
    assert.match(script, /"supportedSubmitMethods": \[\s*"get",\s*"post"\s*\]/);
  });

  await t.test("documentation does not intercept or replace the existing HTTP handlers", async () => {
    assert.deepEqual(await requestJson(server.baseUrl, "/health"), { status: 200, body: { service: "lis", status: "ok" } });
    assert.equal((await requestJson(server.baseUrl, "/ready")).status, 503);
    const invalid = await requestJson(server.baseUrl, "/api/results?limit=101");
    assert.equal(invalid.status, 400);
    assert.ok(isRecord(invalid.body) && isRecord(invalid.body.error));
    assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
    assert.equal((await requestJson(server.baseUrl, "/api/results/A3-DEMO-R1/publish", { method: "POST" })).status, 503);
  });
});
