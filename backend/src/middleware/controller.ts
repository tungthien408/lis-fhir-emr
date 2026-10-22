import type { Express } from "express";
import { middlewareDatabase } from "./db.js";

export function registerMiddlewareRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "middleware", status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    const result = await middlewareDatabase.check();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "middleware", ...result });
  });
}
