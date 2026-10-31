import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type RequestListener } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import type { TestContext } from "node:test";

export async function eventually(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await pause(10); }
  assert.fail(message);
}

/** Real listeners only; restart rebinds the same local port, without substituting a fake route. */
export async function listen(t: TestContext, handler: RequestListener) {
  const server = createServer(handler); let port = 0;
  async function start() {
    if (server.listening) return;
    server.listen(port, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
  }
  async function close() {
    if (!server.listening) return;
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  }
  await start(); t.after(close);
  return { baseUrl: `http://127.0.0.1:${port}`, start, close };
}

export interface HttpTrace {
  method: string; path: string; query: Record<string, string>; content_type: string | null;
  request_body: unknown; request_sha256?: string; raw_request: string;
  upstream_status: number | null; response_body: unknown;
  transport: "pending" | "forwarded" | "dropped" | "held" | "disconnected" | "upstream_unavailable";
}
interface Fault { method: string; path: string; action: "drop" | "hold"; trace?: HttpTrace; release(): void; released: Promise<void> }

/** Test transport relay. Every status/body comes from the real upstream HTTP application. */
export async function relay(t: TestContext, upstreamUrl: string) {
  const upstream = new URL(upstreamUrl); assert.equal(upstream.hostname, "127.0.0.1");
  const traces: HttpTrace[] = []; const failures: string[] = []; const faults: Fault[] = [];
  const armed: Fault[] = [];
  t.after(() => { for (const fault of faults) fault.release(); assert.deepEqual(failures, []); });
  const endpoint = await listen(t, (req, res) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks); const parsed = new URL(req.url ?? "/", upstream);
      const entry: HttpTrace = { method: req.method ?? "GET", path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams), content_type: req.headers["content-type"] ?? null,
        request_body: raw.length ? JSON.parse(raw.toString("utf8")) as unknown : null, raw_request: raw.toString("utf8"),
        upstream_status: null, response_body: null, transport: "pending" };
      traces.push(entry);
      const faultIndex = armed.findIndex((fault) => fault.method === entry.method && fault.path === entry.path);
      const fault = faultIndex < 0 ? undefined : armed.splice(faultIndex, 1)[0];
      const response = await new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer } | undefined>((resolve) => {
        const outgoing = request(new URL(req.url ?? "/", upstream), { method: req.method,
          headers: { ...req.headers, host: upstream.host }, agent: false }, (incoming) => {
          const buffers: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => buffers.push(chunk));
          incoming.on("error", () => resolve(undefined));
          incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: Buffer.concat(buffers) }));
        });
        outgoing.setTimeout(7000, () => outgoing.destroy());
        outgoing.on("error", () => resolve(undefined)); outgoing.end(raw);
      });
      if (!response) { entry.transport = "upstream_unavailable"; res.destroy(); return; }
      entry.upstream_status = response.status;
      entry.response_body = response.body.length ? JSON.parse(response.body.toString("utf8")) as unknown : null;
      if (fault) {
        fault.trace = entry;
        if (fault.action === "drop") { entry.transport = "dropped"; res.destroy(); return; }
        entry.transport = "held"; await fault.released;
      }
      if (res.destroyed) { entry.transport = "disconnected"; return; }
      entry.transport = "forwarded";
      res.writeHead(response.status, response.headers); res.end(response.body); // Forward actual bytes unchanged.
    })().catch(() => { failures.push("D3 HTTP recorder failed"); res.destroy(); });
  });
  return { ...endpoint, traces,
    fault(method: string, path: string, action: "drop" | "hold") {
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      const fault: Fault = { method, path, action, release, released }; faults.push(fault); armed.push(fault);
      return { release,
        async observed() { await eventually(() => fault.trace !== undefined, "Expected a real upstream HTTP response before the transport fault"); return fault.trace!; },
      };
    },
  };
}
