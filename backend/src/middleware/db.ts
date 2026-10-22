import { createDatabaseConnection } from "../common/database.js";

export const middlewareDatabase = createDatabaseConnection({
  service: "MIDDLEWARE",
  schema: "integration",
  expectedRole: "integration_app",
  envName: "MIDDLEWARE_DATABASE_URL",
  expectedTables: ["exchange_transactions", "exchange_attempts", "exchange_events"],
});
