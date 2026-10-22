import type { Express } from "express";
import { emrDatabase } from "./db.js";

export function registerEmrRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "emr", status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    const result = await emrDatabase.check();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "emr", ...result });
  });
}
