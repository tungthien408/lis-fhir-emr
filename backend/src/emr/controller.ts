/** C3: HTTP parsing, query validation and response mapping; C2 owns business rules. */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { emrDatabase } from "./db.js";
import { findPatient, getLabResultsBySource, listLabResults, storeObservation } from "./service.js";

export interface EmrRouteDependencies {
  findPatient: typeof findPatient;
  storeObservation: typeof storeObservation;
  getLabResultsBySource: typeof getLabResultsBySource;
  listLabResults: typeof listLabResults;
  checkDatabase: typeof emrDatabase.check;
}

const defaultDependencies: EmrRouteDependencies = {
  findPatient, storeObservation, getLabResultsBySource, listLabResults, checkDatabase: emrDatabase.check,
};

/** Shared by startup and HTTP tests. Parse JSON values; C2 requires an Observation object. */
export function emrJsonParser() {
  const parseJson = express.json({
    type: ["application/json", "application/fhir+json"], limit: "1mb", strict: false,
    // This HTTP API supports only identity Content-Encoding.
    inflate: false,
  });
  return (req: Request, res: Response, next: NextFunction): void => {
    // Check the FHIR boundary before parsing, even when a wrong-media body is malformed.
    if (req.method === "POST" && /^\/api\/observations\/?$/i.test(req.path)) {
      if (req.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/fhir+json") {
        sendError(res, 415, "VALIDATION_ERROR", "Content-Type must be application/fhir+json"); return;
      }
      const encoding = req.get("Content-Encoding");
      if (encoding !== undefined && encoding.trim().toLowerCase() !== "identity") {
        sendError(res, 415, "VALIDATION_ERROR", "Unsupported request body encoding"); return;
      }
    }
    parseJson(req, res, next);
  };
}

class InvalidHttpInput extends Error {}

/** Read every raw query entry, including duplicates beyond Express's parser limit. */
function queryParameters(req: Request): Map<string, string> {
  const raw = req.originalUrl.split("?").slice(1).join("?");
  try { decodeURIComponent(raw.replace(/\+/g, " ")); }
  catch { throw new InvalidHttpInput("Malformed query encoding"); }
  const query = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (query.has(key)) throw new InvalidHttpInput("Repeated query parameters are not supported");
    query.set(key, value);
  }
  return query;
}

function identifier(value: string | undefined, field: string): string {
  if (value === undefined || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new InvalidHttpInput(`${field} must be a non-empty identifier without control characters`);
  }
  return value; // Never trim or normalize an external identity.
}

function pagination(value: string | undefined, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new InvalidHttpInput(`${field} must contain only integer digits`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new InvalidHttpInput(`${field} is outside the allowed range`);
  }
  return number;
}

/** Exactly two mutually exclusive modes; source lookup never paginates. */
function labResultQuery(req: Request) {
  const query = queryParameters(req);
  const allowed = new Set(["external_system", "external_id", "patient_key", "limit", "offset"]);
  if ([...query.keys()].some((key) => !allowed.has(key))) throw new InvalidHttpInput("Unsupported lab result query parameter");
  if (query.has("external_system") || query.has("external_id")) {
    if (query.has("patient_key") || query.has("limit") || query.has("offset")) {
      throw new InvalidHttpInput("External identity cannot be combined with patient filters or pagination");
    }
    return { mode: "source" as const,
      externalSystem: identifier(query.get("external_system"), "external_system"),
      externalId: identifier(query.get("external_id"), "external_id") };
  }
  const patientKey = identifier(query.get("patient_key"), "patient_key");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientKey)) {
    throw new InvalidHttpInput("patient_key must be a UUID in 8-4-4-4-12 format");
  }
  return { mode: "patient" as const, patientKey,
    limit: pagination(query.get("limit"), "limit", 20, 1, 100),
    offset: pagination(query.get("offset"), "offset", 0, 0, Number.MAX_SAFE_INTEGER) };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function registerEmrRoutes(app: Express, dependencies: EmrRouteDependencies = defaultDependencies): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "emr", status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    const result = await dependencies.checkDatabase();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "emr", ...result });
  });

  app.post("/api/observations", async (req, res) => {
    if (queryParameters(req).size) throw new InvalidHttpInput("This endpoint does not support query parameters");
    if (req.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/fhir+json") {
      sendError(res, 415, "VALIDATION_ERROR", "Content-Type must be application/fhir+json"); return;
    }
    const outcome = await dependencies.storeObservation(req.body);
    switch (outcome.kind) {
      case "stored":
      case "already_exists":
        // Await C2's committed outcome; never expose its internal discriminant.
        res.status(outcome.kind === "stored" ? 201 : 200).json({
          result: outcome.result, external_system: outcome.external_system, external_id: outcome.external_id,
          target_id: outcome.target_id, patient_key: outcome.patient_key,
        }); return;
      case "conflict":
        sendError(res, 409, outcome.error.code, outcome.error.message); return;
      case "invalid":
      case "unsupported":
      case "patient_not_linked":
        sendError(res, 422, outcome.error.code, outcome.error.message); return;
      case "unavailable":
        sendError(res, 503, outcome.error.code, outcome.error.message); return;
    }
  });

  app.get("/api/patients", async (req, res) => {
    const outcome = await dependencies.findPatient(Object.fromEntries(queryParameters(req)));
    res.set("Cache-Control", "no-store");
    if (outcome.kind === "found") res.status(200).json({ patient: outcome.patient });
    else sendError(res, outcome.kind === "not_found" ? 404 : outcome.kind === "unavailable" ? 503 : 400,
      outcome.error.code, outcome.error.message);
  });

  app.get("/api/lab-results", async (req, res) => {
    const query = labResultQuery(req);
    const outcome = query.mode === "source"
      ? await dependencies.getLabResultsBySource(query.externalSystem, query.externalId)
      : await dependencies.listLabResults({ patientKey: query.patientKey, limit: query.limit, offset: query.offset });
    if (outcome.kind === "found") {
      // Persisted NUMERIC strings, complete timestamps and original FHIR pass through untouched.
      res.status(200).json(query.mode === "source" ? { items: outcome.items }
        : { items: outcome.items, limit: query.limit, offset: query.offset });
    } else {
      sendError(res, outcome.kind === "unavailable" ? 503 : 400, outcome.error.code, outcome.error.message);
    }
  });

  app.use("/api", (_req, res) => { sendError(res, 404, "NOT_FOUND", "API route not found"); });

  // Express 5 forwards rejected async handlers and upstream JSON parsing errors.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (error instanceof InvalidHttpInput) {
      sendError(res, 400, "VALIDATION_ERROR", error.message);
    } else if (error instanceof URIError) {
      sendError(res, 400, "VALIDATION_ERROR", "Malformed request path");
    } else if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
      sendError(res, 413, "VALIDATION_ERROR", "Request body exceeds the allowed size");
    } else if (error instanceof Error && "type" in error
      && (error.type === "charset.unsupported" || error.type === "encoding.unsupported")) {
      sendError(res, 415, "VALIDATION_ERROR", "Unsupported request body encoding");
    } else if (error instanceof Error && "status" in error && error.status === 400
      && "expose" in error && error.expose === true) {
      sendError(res, 400, "VALIDATION_ERROR", "Request body must contain valid JSON");
    } else {
      sendError(res, 503, "DEPENDENCY_UNAVAILABLE", "EMR persistence is temporarily unavailable");
    }
  });
}
