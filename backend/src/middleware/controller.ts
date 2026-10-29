/** B3: HTTP validation/serialization only. Acceptance rules stay in B2/B1. */
import type { Express, NextFunction, Request, Response } from "express";
import { middlewareDatabase } from "./db.js";
import {
  getExchangeById, getExchangeEvents, listExchanges,
  type ExchangeEvent, type ExchangeTransaction, type ListExchangesOptions,
} from "./repository.js";
import { acceptExchange } from "./service.js";

/** Optional dependencies support HTTP tests without touching a real database. */
export interface MiddlewareRouteDependencies {
  acceptExchange: typeof acceptExchange;
  listExchanges: typeof listExchanges;
  getExchangeById: typeof getExchangeById;
  getExchangeEvents: typeof getExchangeEvents;
  checkDatabase: typeof middlewareDatabase.check;
}

const defaultDependencies: MiddlewareRouteDependencies = {
  acceptExchange, listExchanges, getExchangeById, getExchangeEvents,
  checkDatabase: middlewareDatabase.check,
};

class InvalidHttpInput extends Error {}

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

function listOptions(query: Request["query"]): ListExchangesOptions & { limit: number; offset: number } {
  const allowed = new Set(["status", "source_result_id", "limit", "offset"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new InvalidHttpInput("Unsupported exchange query parameter");
  const options: ListExchangesOptions & { limit: number; offset: number } = {
    limit: pagination(query.limit, "limit", 20, 1, 100),
    offset: pagination(query.offset, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
  };
  if (query.status !== undefined) {
    const status = (["RECEIVED", "PROCESSING", "VERIFYING", "RETRY_WAIT", "DELIVERED", "REJECTED", "FAILED"] as const)
      .find((value) => value === query.status);
    if (!status) throw new InvalidHttpInput("Unsupported exchange status");
    options.status = status;
  }
  if (query.source_result_id !== undefined) {
    const value = query.source_result_id;
    if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new InvalidHttpInput("source_result_id must be a non-empty identifier without control characters");
    }
    options.sourceResultId = value;
  }
  return options;
}

function noQuery(query: Request["query"]): void {
  if (Object.keys(query).length) throw new InvalidHttpInput("This endpoint does not support query parameters");
}

/** Explicit allowlist: list items do not include payloads or internal leases. */
function summary(row: ExchangeTransaction) {
  return {
    exchange_id: row.exchangeId, event_id: row.eventId,
    source_system: row.sourceSystem, source_result_id: row.sourceResultId, source_hash: row.sourceHash,
    status: row.status, retry_phase: row.retryPhase,
    send_attempt_count: row.sendAttemptCount, verify_attempt_count: row.verifyAttemptCount,
    published_at: row.publishedAt, received_at: row.receivedAt, next_retry_at: row.nextRetryAt,
    completed_at: row.completedAt,
  };
}

function history(event: ExchangeEvent) {
  // detail is arbitrary diagnostic JSON; expose persisted event metadata only.
  return {
    log_event_id: event.logEventId, exchange_id: event.exchangeId, event_type: event.eventType,
    old_status: event.oldStatus, new_status: event.newStatus,
    occurred_at: event.occurredAt, attempt_id: event.attemptId,
  };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function registerMiddlewareRoutes(app: Express, dependencies: MiddlewareRouteDependencies = defaultDependencies): void {
  app.get("/health", (_req, res) => {
    res.status(200).json({ service: "middleware", status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    const result = await dependencies.checkDatabase();
    res.status(result.status === "ready" ? 200 : 503).json({ service: "middleware", ...result });
  });

  app.post("/api/exchanges", async (req, res) => {
    noQuery(req.query);
    // Keep main.ts's JSON parser/1mb limit. Other media types must not be silently
    // skipped by the parser and passed to B2 as though they were valid JSON.
    if (req.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      sendError(res, 415, "VALIDATION_ERROR", "Content-Type must be application/json");
      return;
    }
    const outcome = await dependencies.acceptExchange(req.body);
    switch (outcome.kind) {
      case "accepted":
        res.status(202).json({
          accepted: outcome.accepted, event_id: outcome.event_id, exchange_id: outcome.exchange_id,
          source_system: outcome.source_system, source_result_id: outcome.source_result_id,
          source_hash: outcome.source_hash,
        });
        return;
      case "malformed":
        sendError(res, 400, outcome.error.code, outcome.error.message); return;
      case "invalid":
        sendError(res, 422, outcome.error.code, outcome.error.message); return;
      case "conflict":
        sendError(res, 409, outcome.error.code, outcome.error.message); return;
      case "unavailable":
        sendError(res, 503, outcome.error.code, outcome.error.message); return;
    }
  });

  app.get("/api/exchanges", async (req, res) => {
    const options = listOptions(req.query);
    const rows = await dependencies.listExchanges(options);
    res.status(200).json({ items: rows.map(summary), limit: options.limit, offset: options.offset });
  });

  app.get("/api/exchanges/:exchangeId", async (req, res) => {
    noQuery(req.query);
    const exchangeId = req.params.exchangeId;
    if (typeof exchangeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(exchangeId)) {
      throw new InvalidHttpInput("exchangeId must be a UUID in 8-4-4-4-12 format");
    }
    const row = await dependencies.getExchangeById(exchangeId);
    if (!row) { sendError(res, 404, "NOT_FOUND", "Exchange not found"); return; }
    const events = await dependencies.getExchangeEvents(row.exchangeId);
    res.status(200).json({
      ...summary(row), source_payload: row.sourcePayload, fhir_payload: row.fhirPayload,
      payload_hash: row.payloadHash, mapping_version: row.mappingVersion,
      validated_at: row.validatedAt, mapping_started_at: row.mappingStartedAt,
      transformed_at: row.transformedAt, first_sent_at: row.firstSentAt,
      target_stored_at: row.targetStoredAt, verified_at: row.verifiedAt,
      events: events.map(history),
    });
  });

  app.use("/api", (_req, res) => { sendError(res, 404, "NOT_FOUND", "API route not found"); });

  // Express 5 forwards async handler rejections and upstream JSON parser errors.
  app.use("/api", (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { next(error); return; }
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
    } else if (error instanceof Error && "status" in error && error.status === 400
      && "expose" in error && error.expose === true) {
      // body-parser also wraps corrupt compressed streams/aborted reads as 400.
      // They are input failures, not database outages; never echo their message.
      sendError(res, 400, "VALIDATION_ERROR", "Request body is invalid");
    } else {
      sendError(res, 503, "DEPENDENCY_UNAVAILABLE", "Middleware data access is unavailable. Please try again later.");
    }
  });
}
