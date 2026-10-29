import { randomUUID } from "node:crypto";
// Test-only cross-service import: generate requests with the real LIS hash.
import { hashCanonicalJson } from "../../src/lis/canonical-json.js";
import type { ExchangeTransaction, SourceEnvelope } from "../../src/middleware/repository.js";
import { newExchange } from "./fixtures.js";

export function validEnvelope(): SourceEnvelope {
  const envelope = newExchange().sourceEnvelope;
  envelope.source_hash = hashCanonicalJson(envelope.source_snapshot);
  return envelope;
}

export function rehash(envelope: SourceEnvelope): SourceEnvelope {
  envelope.source_hash = hashCanonicalJson(envelope.source_snapshot);
  return envelope;
}

/** Complete synthetic row for Service unit tests; no PostgreSQL connection. */
export function syntheticTransaction(envelope: SourceEnvelope): ExchangeTransaction {
  return {
    exchangeId: randomUUID(), eventId: envelope.event_id, sourceSystem: envelope.source_system,
    sourceResultId: envelope.source_result_id, sourcePayload: structuredClone(envelope),
    sourceHash: envelope.source_hash, status: "RECEIVED", sendAttemptCount: 0, verifyAttemptCount: 0,
    receivedAt: new Date("2026-10-26T08:00:00Z"), publishedAt: new Date(envelope.published_at),
    patientIdentifier: null, fhirPayload: null, payloadHash: null, mappingVersion: null,
    retryPhase: null, nextRetryAt: null, leaseUntil: null, leaseToken: null,
    validatedAt: null, mappingStartedAt: null, transformedAt: null, firstSentAt: null,
    targetStoredAt: null, verifiedAt: null, completedAt: null,
  };
}
