/** Read-only snapshots through each existing service role. No evaluator privilege changes, writes or production imports. */
import { Client } from 'pg';
import { uuid } from './exact-values.js';
import { tables, type EvidenceSnapshot, type FrozenReference, type Row, type TableName } from './verification-types.js';
export interface Reader {
  connect(): Promise<unknown>; query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>; end(): Promise<void>;
}
export type ReaderFactory = (url: string) => Reader;
const utc = (column: string) => `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** Fixed, parameterized SQL only. JSONB remains TEXT until the lossless evaluator parser. */
export const captureQueries = {
  lis_results: `SELECT r.result_id,r.patient_id,r.test_code,r.value_num::text,r.unit,r.reference_low::text,r.reference_high::text,
    ${utc('r.effective_at')} AS effective_at,r.result_status,r.provenance->>'seed_tag' AS seed_tag,
    r.provenance->>'source_labevent_id' AS source_labevent_id,t.test_name,t.fluid,t.category
    FROM lis.results r LEFT JOIN lis.test_catalog t ON r.test_code=t.test_code
    WHERE r.provenance->>'seed_tag'=$1 OR r.result_id=ANY($2::text[]) ORDER BY r.result_id`,
  publish_events: `SELECT event_id::text,result_id,source_system,exchange_id::text,dispatch_status,
    ${utc('published_at')} AS published_at FROM lis.publish_events
    WHERE source_system=$1 OR result_id=ANY($2::text[]) ORDER BY result_id,event_id`,
  exchanges: `SELECT exchange_id::text,event_id::text,source_system,source_result_id,status,fhir_payload::text AS fhir_text,
    ${utc('received_at')} AS received_at FROM integration.exchange_transactions
    WHERE source_system=$1 OR source_result_id=ANY($2::text[]) ORDER BY source_result_id,exchange_id`,
  send_receipts: `SELECT a.exchange_id::text,a.attempt_id::text,a.attempt_no,a.http_status,a.response_body::text AS receipt_text
    FROM integration.exchange_attempts a JOIN integration.exchange_transactions e USING(exchange_id)
    WHERE a.phase='SEND' AND a.http_status IN (200,201) AND (e.source_system=$1 OR e.source_result_id=ANY($2::text[]))
    ORDER BY a.exchange_id,a.attempt_no`,
  emr_results: `SELECT target_id::text,patient_key::text,external_system,external_id,analyte_system,analyte_code,analyte_display,
    analyte_context,quantity::text,unit_text,low::text,high::text,${utc('effective_at')} AS effective_at,
    clinical_status,fhir_json::text AS fhir_text,${utc('stored_at')} AS stored_at
    FROM emr.lab_results WHERE external_system=$1 OR external_id=ANY($2::text[]) OR target_id=ANY($3::uuid[])
    ORDER BY external_system,external_id,target_id`,
  patient_links: `SELECT identifier_system,identifier_value,patient_key::text FROM emr.patient_links
    WHERE identifier_system=$1 OR identifier_value=ANY($2::text[]) ORDER BY identifier_system,identifier_value`,
  emr_patients: `SELECT patient_key::text FROM emr.patients WHERE patient_key=ANY($1::uuid[]) ORDER BY patient_key`,
} as const;
export async function captureEvidence(reference: FrozenReference, phase: 'before' | 'after', runId: string | null,
  env: NodeJS.ProcessEnv, factory: ReaderFactory = (url) => new Client({ connectionString: url, connectionTimeoutMillis: 3000, query_timeout: 15000 })) {
  const token = env.SPP82_VERIFICATION_ISOLATION_TOKEN;
  if (!uuid(token)) throw new Error('ISOLATED_HARNESS_TOKEN_REQUIRED');
  const specs = [
    { service: 'lis', role: 'lis_app', key: 'LIS_VERIFY_DATABASE_URL', tables: ['lis_results', 'publish_events'] },
    { service: 'middleware', role: 'integration_app', key: 'MIDDLEWARE_VERIFY_DATABASE_URL', tables: ['exchanges', 'send_receipts'] },
    { service: 'emr', role: 'emr_app', key: 'EMR_VERIFY_DATABASE_URL', tables: ['emr_results', 'patient_links', 'emr_patients'] },
  ] as const;
  const origins = new Set<string>();
  for (const spec of specs) {
    let url: URL; try { url = new URL(env[spec.key] ?? ''); } catch { throw new Error('INVALID_READER_CONFIGURATION'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== spec.role || url.pathname !== '/dacn_db'
      || url.search || url.hash) throw new Error('INVALID_READER_CONFIGURATION');
    origins.add(url.host + url.pathname);
  }
  if (origins.size !== 1) throw new Error('READERS_MUST_SHARE_DATABASE');
  const snapshot: EvidenceSnapshot = {
    schema_version: 1, phase, run_id: runId, environment_id: token, oracle_manifest_sha256: reference.manifest_sha256,
    captured_at: new Date().toISOString(), scope: { source_system: reference.rules.source_system, result_system: reference.rules.result_system,
      seed_tag: reference.rules.seed_tag, coverage: 'namespace-and-expected-identities' }, snapshots: {},
    tables: Object.fromEntries(tables.map((name) => [name, { status: 'unavailable', reason: 'NOT_READ' }])) as EvidenceSnapshot['tables'],
  };
  const ids = reference.results.map((row) => row.result_id); const patients = reference.results.map((row) => row.patient_id);
  const keys = reference.patient_links.map((row) => row.patient_key);
  const targetIds: string[] = [];
  for (const spec of specs) {
    const reader = factory(env[spec.key]!);
    try {
      await reader.connect(); await reader.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await reader.query("SET LOCAL statement_timeout = '10000ms'");
      const identity = (await reader.query(`SELECT current_user AS role,current_database() AS database,
        current_setting('transaction_read_only') AS read_only,${utc('clock_timestamp()')} AS server_time,
        shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`)).rows[0];
      if (identity?.role !== spec.role || identity.database !== 'dacn_db' || identity.read_only !== 'on'
        || identity.marker !== `spp66-disposable:${token}`) throw new Error('ISOLATED_ROLE_GUARD_FAILED');
      snapshot.snapshots[spec.service] = { role: spec.role, server_time: String(identity.server_time), consistency: 'repeatable-read-read-only' };
      for (const name of spec.tables) {
        const args: unknown[] = name === 'lis_results' ? [reference.rules.seed_tag, ids]
          : name === 'emr_results' ? [reference.rules.result_system, ids, targetIds]
          : name === 'patient_links' ? [reference.rules.patient_system, patients]
          : name === 'emr_patients' ? [keys] : [reference.rules.source_system, ids];
        const rows = (await reader.query(captureQueries[name], args)).rows;
        snapshot.tables[name] = { status: 'available', rows };
        if (name === 'send_receipts') for (const row of rows) {
          try { const receipt = JSON.parse(String(row.receipt_text)) as Row;
            if (uuid(receipt.target_id)) targetIds.push(receipt.target_id); } catch { /* Retain malformed receipt for comparator. */ }
        }
      }
      await reader.query('ROLLBACK'); // Read-only snapshot has no writes to commit.
    } catch {
      for (const name of spec.tables) snapshot.tables[name as TableName] = { status: 'unavailable', reason: 'READ_OR_ISOLATION_GUARD_FAILED' };
      snapshot.snapshots[spec.service] = null;
      await reader.query('ROLLBACK').catch(() => {});
    } finally { await reader.end().catch(() => {}); }
  }
  return snapshot;
}
