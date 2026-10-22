import type { Express } from "express";
import { lisDatabase } from "./db.js";

export function registerLisRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "lis", status: "ok" });
  });

  // Khác /health: chỉ báo OK khi đã kết nối được PostgreSQL và tìm đủ 5 bảng LIS.
  app.get("/ready", async (_req, res) => {
    const result = await lisDatabase.check();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "lis", ...result });
  });
}
