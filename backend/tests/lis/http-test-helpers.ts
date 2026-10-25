import { once } from "node:events";
import type { Express } from "express";

/** Real HTTP on a temporary localhost port; no extra test dependency. */
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

export interface JsonResponse {
  status: number;
  body: unknown;
}

export async function requestJson(baseUrl: string, path: string, options?: RequestInit): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(7000) });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
