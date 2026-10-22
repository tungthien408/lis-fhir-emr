import { createDatabaseConnection } from "../common/database.js";

export const emrDatabase = createDatabaseConnection({
  service: "EMR",
  schema: "emr",
  expectedRole: "emr_app",
  envName: "EMR_DATABASE_URL",
  expectedTables: ["patients", "patient_links", "lab_results"],
});
