import express from "express";
import { registerEmrRoutes } from "./controller.js";

const port = Number(process.env.EMR_PORT ?? 3103);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("EMR_PORT phai la so nguyen tu 1 den 65535");
}

const app = express();
app.use(express.json({ limit: "1mb" }));
registerEmrRoutes(app);

// Chi lang nghe localhost: prototype chay tren may cua nhom.
app.listen(port, host, () => {
  console.log("[EMR] Dang chay: http://127.0.0.1:" + port);
});
