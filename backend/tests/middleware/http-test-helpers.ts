import assert from "node:assert/strict";
import { once } from "node:events";
import type { Express } from "express";

/** Real HTTP, temporary localhost port, no extra test dependency. */
export async function startHttpServer(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing HTTP test address");
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
  const body: unknown = await response.json();
  return { status: response.status, body };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertError(response: JsonResponse, status: number, code: string): void {
  assert.equal(response.status, status);
  assert.ok(isRecord(response.body) && isRecord(response.body.error));
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.deepEqual(Object.keys(response.body), ["error"]);
  assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
}

export function acceptedId(response: JsonResponse): string {
  assert.equal(response.status, 202);
  assert.ok(isRecord(response.body) && typeof response.body.exchange_id === "string");
  assert.equal(response.body.accepted, true);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "accepted", "event_id", "exchange_id", "source_hash", "source_result_id", "source_system",
  ]);
  return response.body.exchange_id;
}

export function listedIds(response: JsonResponse): string[] {
  assert.equal(response.status, 200);
  assert.ok(isRecord(response.body) && Array.isArray(response.body.items));
  return response.body.items.map((item: unknown) => {
    assert.ok(isRecord(item) && typeof item.exchange_id === "string"); return item.exchange_id;
  });
}
