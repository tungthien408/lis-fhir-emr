import assert from "node:assert/strict";
import { once } from "node:events";
import type { Express } from "express";

/** Same real localhost HTTP convention as the LIS/Middleware suites. */
export async function startHttpServer(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP test address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
export interface JsonResponse { status: number; body: unknown }
export async function requestJson(baseUrl: string, path: string, options?: RequestInit): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(7000) });
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  return { status: response.status, body: await response.json() as unknown };
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function assertError(response: JsonResponse, status: number, code: string) {
  assert.equal(response.status, status);
  assert.ok(isRecord(response.body)); assert.ok(isRecord(response.body.error));
  assert.deepEqual(Object.keys(response.body), ["error"]);
  assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.doesNotMatch(JSON.stringify(response.body), /SELECT|postgresql:|secret|private-stack|patient-private/);
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
