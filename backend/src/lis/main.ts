import express from "express";
import { registerLisRoutes } from "./controller.js";
import { registerLisApiDocs } from "./api-docs.js";

const port = Number(process.env.LIS_PORT ?? 3101);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("LIS_PORT phai la so nguyen tu 1 den 65535");
}

const app = express();
app.use(express.json({ limit: "1mb" }));
registerLisRoutes(app);
registerLisApiDocs(app);

// Chi lang nghe localhost: prototype chay tren may cua nhom.
app.listen(port, host, () => {
  console.log("[LIS] Dang chay: http://127.0.0.1:" + port);
  console.log("[LIS] Thu API: http://127.0.0.1:" + port + "/docs/api/");
});
