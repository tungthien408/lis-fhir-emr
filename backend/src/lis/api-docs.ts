import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { lisOpenApiDocument } from "./openapi.js";

/** Trang thử API, dùng CSS/JS cài cùng backend và gọi chính server đang mở. */
export function registerLisApiDocs(app: Express): void {
  app.get("/docs/api/openapi.json", (_req, res) => {
    res.json(lisOpenApiDocument);
  });

  const options: swaggerUi.SwaggerUiOptions = {
    customSiteTitle: "LIS — Thử API",
    customCss: ".swagger-ui .topbar { background-color: #1b5e20; }",
    swaggerOptions: {
      url: "/docs/api/openapi.json",
      validatorUrl: null,
      supportedSubmitMethods: ["get", "post"],
      defaultModelsExpandDepth: -1,
      displayRequestDuration: true,
      filter: true,
    },
  };
  // serveFiles gives this app its own init script, rather than module-global state.
  app.use("/docs/api", swaggerUi.serveFiles(undefined, options));
  app.get("/docs/api", swaggerUi.setup(undefined, options));
}
