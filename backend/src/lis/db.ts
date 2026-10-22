import { createDatabaseConnection } from "../common/database.js";

// Mỗi ứng dụng phải dùng URL/role riêng. Không dùng chung tài khoản postgres admin.
export const lisDatabase = createDatabaseConnection({
  service: "LIS",
  schema: "lis",
  expectedRole: "lis_app",
  envName: "LIS_DATABASE_URL",
  expectedTables: ["patients", "test_catalog", "results", "publish_events", "dispatch_attempts"],
});
