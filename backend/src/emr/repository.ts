/**
 * SPP-66 C1: EMR persistence only, through emrDatabase (emr_app).
 * C2 supplies validated, PostgreSQL-representable values and patient identity;
 * it also decides whether an existing row is an identical retry or a conflict.
 * No FHIR mapping/validation, HTTP handling, or cross-service imports here.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { emrDatabase } from "./db.js";
import { labResults, patientLinks, patients } from "./schema.js";

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** Prepared by the future Service. Decimal and timestamp inputs stay text. */
export interface NewLabResult {
  targetId: string;
  patientKey: string;
  externalSystem: string;
  externalId: string;
  analyteSystem: string;
  analyteCode: string;
  analyteDisplay?: string | null;
  analyteContext?: string | null;
  quantity: string;
  unitText: string;
  low?: string | null;
  high?: string | null;
  /** Full timestamp with timezone, representable at PostgreSQL microseconds. */
  effectiveAt: string;
  clinicalStatus: "final";
  /** Original Observation object; persistence never adds id/meta or edits it. */
  fhirJson: JsonObject;
  /** Omitted timestamps use the DDL's clock_timestamp() defaults. */
  receivedAt?: string;
  storedAt?: string;
}

// SQL text bypasses BOTH pg's timestamp parser and Drizzle's mode:"date".
// Never feed effective_at through Date: .123456 seconds would become .123 seconds.
const utcTimestamp = (column: typeof labResults.effectiveAt | typeof labResults.receivedAt) =>
  sql<string>`case when isfinite(${column})
      and extract(year from ${column} at time zone 'UTC') between 1 and 9999
    then to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    else 'UNREPRESENTABLE_TIMESTAMP' end`.mapWith((value: string) => {
      // DDL allows infinity/BC/wider years; never disguise those as valid ISO.
      if (value === "UNREPRESENTABLE_TIMESTAMP") {
        throw new Error("EMR timestamp cannot be represented as a finite ISO instant in years 0001–9999");
      }
      return value;
    });

/** Storage precision guard only; FHIR format/calendar validation belongs to C2. */
function timestampParameter(value: string) {
  const fraction = /\.(\d+)/.exec(value)?.[1];
  if (fraction && /[1-9]/.test(fraction.slice(6))) {
    throw new RangeError("EMR timestamp exceeds PostgreSQL microsecond precision");
  }
  return sql`${value}::timestamptz`;
}

/** Snake-case fields match the existing GET contract; no lossy Date/Number. */
const labResultSelection = {
  target_id: labResults.targetId,
  patient_key: labResults.patientKey,
  external_system: labResults.externalSystem,
  external_id: labResults.externalId,
  analyte_system: labResults.analyteSystem,
  analyte_code: labResults.analyteCode,
  analyte_display: labResults.analyteDisplay,
  analyte_context: labResults.analyteContext,
  quantity: labResults.quantity,
  unit_text: labResults.unitText,
  low: labResults.low,
  high: labResults.high,
  effective_at: utcTimestamp(labResults.effectiveAt),
  clinical_status: labResults.clinicalStatus,
  fhir_json: sql<JsonObject>`${labResults.fhirJson}`,
  received_at: utcTimestamp(labResults.receivedAt),
  stored_at: utcTimestamp(labResults.storedAt),
};

export type LabResult = Awaited<ReturnType<typeof getLabResultsBySource>>[number];
export type PersistLabResultOutcome =
  | { kind: "created"; record: LabResult }
  | { kind: "existing"; record: LabResult };

export interface ListLabResultsOptions {
  patientKey: string;
  /** Future Service/Controller validates limit 1–100 and safe offset >= 0. */
  limit?: number;
  offset?: number;
}

export interface PatientLinkTransactionRepository {
  readonly patientKey: string;
  /** The locked link supplies patientKey; callers cannot substitute a patient. */
  createLabResult(input: Omit<NewLabResult, "patientKey">): Promise<PersistLabResultOutcome>;
}

type DatabaseTransaction = Parameters<Parameters<NonNullable<typeof emrDatabase.db>["transaction"]>[0]>[0];

function getDatabase() {
  if (!emrDatabase.db) throw new Error("EMR_DATABASE_URL is not configured");
  return emrDatabase.db;
}

/** Exact composite-key lookup only; missing link returns undefined. */
export async function getPatientKeyByIdentifier(
  identifierSystem: string, identifierValue: string,
): Promise<string | undefined> {
  const [link] = await getDatabase().select({ patientKey: patientLinks.patientKey })
    .from(patientLinks).where(and(
      eq(patientLinks.identifierSystem, identifierSystem),
      eq(patientLinks.identifierValue, identifierValue),
    ));
  return link?.patientKey;
}

/** Return every row of the exact source pair: no pagination/deduplication. */
export async function getLabResultsBySource(externalSystem: string, externalId: string) {
  return getDatabase().select(labResultSelection).from(labResults).where(and(
    eq(labResults.externalSystem, externalSystem), eq(labResults.externalId, externalId),
  )).orderBy(asc(labResults.targetId));
}

/** Newest clinical instant first; unique target_id breaks timestamp ties. */
export async function listLabResults(options: ListLabResultsOptions): Promise<LabResult[]> {
  return getDatabase().select(labResultSelection).from(labResults)
    .where(eq(labResults.patientKey, options.patientKey))
    .orderBy(desc(labResults.effectiveAt), asc(labResults.targetId))
    .limit(options.limit ?? 20).offset(options.offset ?? 0);
}

/**
 * Atomic UNIQUE arbitration; returns only after COMMIT. Never updates a winner.
 * Only the source-pair conflict is expected; FK/CHECK/target UUID failures throw.
 * A second READ COMMITTED statement sees the winner after INSERT waits, unlike
 * a same-statement CTE fallback whose snapshot may predate the winner's commit.
 */
export async function createLabResult(input: NewLabResult): Promise<PersistLabResultOutcome> {
  return getDatabase().transaction((tx) => persistLabResult(tx, input), { isolationLevel: "read committed" });
}

/**
 * C2 boundary: keep the exact patient link locked until the result commits.
 * SHARE permits concurrent receipts but blocks reassignment/deletion of the link.
 * Missing link returns undefined, without invoking the operation or creating it.
 */
export async function withPatientLinkTransaction<T>(
  identifierSystem: string,
  identifierValue: string,
  operation: (repository: PatientLinkTransactionRepository) => Promise<T>,
): Promise<T | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [link] = await tx.select({ patientKey: patientLinks.patientKey }).from(patientLinks)
      .where(and(eq(patientLinks.identifierSystem, identifierSystem), eq(patientLinks.identifierValue, identifierValue)))
      .for("share");
    if (!link) return undefined;
    return operation({
      patientKey: link.patientKey,
      createLabResult: (input) => persistLabResult(tx, { ...input, patientKey: link.patientKey }),
    });
  }, { isolationLevel: "read committed" });
}

async function persistLabResult(tx: DatabaseTransaction, input: NewLabResult): Promise<PersistLabResultOutcome> {
  const [created] = await tx.insert(labResults).values({
    ...input,
    effectiveAt: timestampParameter(input.effectiveAt),
    receivedAt: input.receivedAt === undefined ? undefined : timestampParameter(input.receivedAt),
    storedAt: input.storedAt === undefined ? undefined : timestampParameter(input.storedAt),
  }).onConflictDoNothing({ target: [labResults.externalSystem, labResults.externalId] })
    .returning(labResultSelection);
  if (created) return { kind: "created", record: created };

  const existing = await tx.select(labResultSelection).from(labResults).where(and(
    eq(labResults.externalSystem, input.externalSystem), eq(labResults.externalId, input.externalId),
  ));
  if (existing.length !== 1) {
    // Deletion/schema drift is a failure, never a fabricated successful retry.
    throw new Error("Expected exactly one existing EMR lab result after source conflict");
  }
  return { kind: "existing", record: existing[0] };
}


export type PatientLookup = { patient_key: string } | { identifier_system: string; identifier_value: string };
export interface PatientRecord {
  patient_key: string;
  display_label: string | null;
  identifiers: { identifier_system: string; identifier_value: string }[];
}
/** One statement snapshot; exact namespace/value, never joins by display label. */
export async function findPatient(input: PatientLookup): Promise<PatientRecord | undefined> {
  const db = getDatabase();
  const condition = "patient_key" in input ? eq(patients.patientKey, input.patient_key)
    : inArray(patients.patientKey, db.select({ key: patientLinks.patientKey }).from(patientLinks).where(and(
      eq(patientLinks.identifierSystem, input.identifier_system), eq(patientLinks.identifierValue, input.identifier_value))));
  const [patient] = await db.select({ patient_key: patients.patientKey, display_label: patients.displayLabel,
    identifiers: sql<PatientRecord["identifiers"]>`coalesce((select jsonb_agg(jsonb_build_object(
      'identifier_system', links.identifier_system, 'identifier_value', links.identifier_value)
      order by links.identifier_system, links.identifier_value)
      from emr.patient_links links where links.patient_key = emr.patients.patient_key), '[]'::jsonb)`,
  }).from(patients).where(condition);
  return patient;
}
