/**
 * HTTP API LIS (SPP-66 A3): kiểm tra tham số, gọi Service/Repository và trả JSON.
 * Publish chỉ chốt dữ liệu để chờ gửi; không tự đánh dấu ACK hoặc DELIVERED.
 * Lỗi trả thông báo chung, không đưa SQL, mật khẩu hoặc stack trace ra HTTP.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { lisDatabase } from "./db.js";
import {
  getPublishEventByEventId, getResultPublishState, getResultById, listResults,
  type ListResultsOptions, type PublishEvent, type ResultWithDetails,
} from "./repository.js";
import { publishResult } from "./service.js";

/** Optional dependencies let HTTP tests exercise failures without a real database. */
export interface LisRouteDependencies {
  getResultById: typeof getResultById;
  listResults: typeof listResults;
  getPublishEventByEventId: typeof getPublishEventByEventId;
  getResultPublishState: typeof getResultPublishState;
  publishResult: typeof publishResult;
  checkDatabase: typeof lisDatabase.check;
}

const defaultDependencies: LisRouteDependencies = {
  getResultById, listResults, getPublishEventByEventId, getResultPublishState, publishResult,
  checkDatabase: lisDatabase.check,
};

class InvalidHttpInput extends Error {}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new InvalidHttpInput(`${field} must be a non-empty identifier without control characters`);
  }
  return value;
}

function pagination(value: unknown, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new InvalidHttpInput(`${field} must be a non-negative integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new InvalidHttpInput(`${field} is outside the allowed range`);
  }
  return number;
}

function listOptions(query: Request["query"]): Required<Pick<ListResultsOptions, "limit" | "offset">> & ListResultsOptions {
  const allowed = new Set(["patient_id", "test_code", "result_status", "limit", "offset"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new InvalidHttpInput("Unsupported result query parameter");
  }
  const options: Required<Pick<ListResultsOptions, "limit" | "offset">> & ListResultsOptions = {
    limit: pagination(query.limit, "limit", 20, 1, 100),
    offset: pagination(query.offset, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
  };
  if (query.patient_id !== undefined) options.patientId = identifier(query.patient_id, "patient_id");
  if (query.test_code !== undefined) options.testCode = identifier(query.test_code, "test_code");
  if (query.result_status !== undefined) {
    if (query.result_status !== "READY" && query.result_status !== "FINAL") {
      throw new InvalidHttpInput("result_status must be READY or FINAL");
    }
    options.resultStatus = query.result_status;
  }
  return options;
}

function resultResponse(row: ResultWithDetails) {
  const { result, test } = row;
  return {
    result_id: result.resultId, patient_id: result.patientId,
    test_code: result.testCode, test_name: test.testName, fluid: test.fluid, category: test.category,
    value_num: result.valueNum, unit: result.unit,
    reference_low: result.referenceLow, reference_high: result.referenceHigh,
    effective_at: row.effectiveAtIso, result_status: result.resultStatus,
  };
}

function publishResponse(event: PublishEvent) {
  return {
    event_id: event.eventId, result_id: event.resultId,
    dispatch_status: event.dispatchStatus, exchange_id: event.exchangeId,
  };
}

function publishStatusResponse(event: PublishEvent) {
  const code = event.lastErrorCode === null ? null
    : /^[A-Z][A-Z0-9_]{0,63}$/.test(event.lastErrorCode) ? event.lastErrorCode : "DISPATCH_ERROR";
  return { ...publishResponse(event), dispatch_attempt_count: event.dispatchAttemptCount,
    last_error_code: code, last_error_message: event.lastErrorMessage === null ? null : "The latest dispatch attempt failed." };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function registerLisRoutes(app: Express, dependencies: LisRouteDependencies = defaultDependencies): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "lis", status: "ok" });
  });

  // Khác /health: chỉ báo OK khi đã kết nối được PostgreSQL và tìm đủ 5 bảng LIS.
  app.get("/ready", async (_req, res) => {
    const result = await dependencies.checkDatabase();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "lis", ...result });
  });

  app.get("/api/results", async (req, res) => {
    const options = listOptions(req.query);
    const rows = await dependencies.listResults(options);
    res.status(200).json({ items: rows.map(resultResponse), limit: options.limit, offset: options.offset });
  });

  app.get("/api/results/:resultId", async (req, res) => {
    const resultId = identifier(req.params.resultId, "resultId");
    const row = await dependencies.getResultById(resultId);
    if (!row) {
      sendError(res, 404, "NOT_FOUND", "Laboratory result not found");
      return;
    }
    res.status(200).json(resultResponse(row));
  });

  app.get("/api/results/:resultId/publish-event", async (req, res) => {
    const resultId = identifier(req.params.resultId, "resultId");
    if (Object.keys(req.query).length) throw new InvalidHttpInput("This endpoint does not support query parameters");
    const state = await dependencies.getResultPublishState(resultId);
    if (!state) { sendError(res, 404, "NOT_FOUND", "Laboratory result not found"); return; }
    res.set("Cache-Control", "no-store").status(200).json({
      result_id: state.resultId, result_status: state.resultStatus, published: state.event !== null,
      event: state.event === null ? null : { ...publishStatusResponse(state.event),
        published_at: state.event.publishedAt.toISOString(),
        acked_at: state.event.ackedAt?.toISOString() ?? null,
        next_retry_at: state.event.nextRetryAt?.toISOString() ?? null },
    });
  });

  app.post("/api/results/:resultId/publish", async (req, res) => {
    const resultId = identifier(req.params.resultId, "resultId");
    // The path identifies the result. A body is optional and cannot override it.
    const outcome = await dependencies.publishResult(resultId);
    switch (outcome.kind) {
      case "created":
        res.status(202).json(publishResponse(outcome.event));
        return;
      case "existing":
        res.status(200).json(publishResponse(outcome.event));
        return;
      case "not_found":
        sendError(res, 404, "NOT_FOUND", "Laboratory result not found");
        return;
      case "conflict":
        sendError(res, 409, outcome.error.code, outcome.error.message);
        return;
      case "invalid":
        sendError(res, 422, outcome.error.code, outcome.error.message);
        return;
    }
  });

  app.get("/api/publish-events/:eventId", async (req, res) => {
    const eventId = identifier(req.params.eventId, "eventId");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      throw new InvalidHttpInput("eventId must be a UUID in 8-4-4-4-12 format");
    }
    const event = await dependencies.getPublishEventByEventId(eventId);
    if (!event) {
      sendError(res, 404, "NOT_FOUND", "Publish event not found");
      return;
    }
    res.set("Cache-Control", "no-store").status(200).json(publishStatusResponse(event));
  });

  app.use("/api", (_req, res) => {
    sendError(res, 404, "NOT_FOUND", "API route not found");
  });

  // Express 5 forwards rejected async handlers and JSON parser errors here.
  app.use("/api", (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof InvalidHttpInput) {
      sendError(res, 400, "VALIDATION_ERROR", error.message);
    } else if (error instanceof URIError) {
      sendError(res, 400, "VALIDATION_ERROR", "Malformed request path");
    } else if (error instanceof Error && "type" in error && error.type === "entity.parse.failed") {
      sendError(res, 400, "VALIDATION_ERROR", "Request body must contain valid JSON");
    } else if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
      sendError(res, 413, "VALIDATION_ERROR", "Request body exceeds the allowed size");
    } else if (error instanceof Error && "type" in error
      && (error.type === "charset.unsupported" || error.type === "encoding.unsupported")) {
      sendError(res, 415, "VALIDATION_ERROR", "Unsupported request body encoding");
    } else {
      sendError(res, 503, "DEPENDENCY_UNAVAILABLE", "LIS data access is unavailable. Please try again later.");
    }
  });
}
