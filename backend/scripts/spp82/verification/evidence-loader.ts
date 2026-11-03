import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { instantKey, object, uuid } from './exact-values.js';
import { sha256 } from './expected-loader.js';
import { tables, type EvidenceSnapshot, type FrozenReference, type RunRecord, type VerificationRun } from './verification-types.js';
export function loadEvidence(file: string, reference: FrozenReference, phase: 'before' | 'after'): { snapshot: EvidenceSnapshot; checksum: string } {
  const bytes = readFileSync(file); const input: unknown = JSON.parse(bytes.toString('utf8'));
  if (!object(input) || input.schema_version !== 1 || input.phase !== phase || typeof input.environment_id !== 'string'
    || !input.environment_id || (input.run_id !== null && typeof input.run_id !== 'string')
    || input.oracle_manifest_sha256 !== reference.manifest_sha256 || instantKey(input.captured_at) === undefined
    || !object(input.scope) || input.scope.coverage !== 'namespace-and-expected-identities'
    || input.scope.source_system !== reference.rules.source_system || input.scope.result_system !== reference.rules.result_system
    || input.scope.seed_tag !== reference.rules.seed_tag || !object(input.tables)) throw new Error('INVALID_EVIDENCE_SCOPE');
  for (const name of tables) {
    const table = input.tables[name];
    if (!object(table) || (table.status !== 'available' && table.status !== 'unavailable')
      || (table.status === 'available' && (!Array.isArray(table.rows) || !table.rows.every(object)))
      || (table.status === 'unavailable' && typeof table.reason !== 'string')) throw new Error('INVALID_TABLE_EVIDENCE');
  }
  return { snapshot: input as unknown as EvidenceSnapshot, checksum: sha256(bytes) };
}
function record(row: Record<string, unknown>, legacy: boolean): RunRecord {
  const publication = legacy ? row.publish_outcome : row.publication;
  if (typeof row.result_id !== 'string' || !row.result_id || ![null,'NEW','EXISTING','ERROR'].includes(publication as string | null)
    || (row.event_id !== null && !uuid(row.event_id)) || (!legacy && row.exchange_id !== null && !uuid(row.exchange_id))) throw new Error('INVALID_RUN_RECORD');
  if (publication === 'NEW') {
    const http = legacy ? row.http_status : Array.isArray(row.observations)
      ? row.observations.find((v: unknown) => object(v) && v.stage === 'publish')?.http_status : undefined;
    if (http !== 202) throw new Error('NEW_PUBLICATION_REQUIRES_202_EVIDENCE');
  }
  return { result_id: row.result_id, event_id: row.event_id as string | null,
    exchange_id: legacy ? null : row.exchange_id as string | null,
    publication: publication as RunRecord['publication'], outcome: typeof row.outcome === 'string' ? row.outcome : 'publish-only' };
}
/** Streams a JSONL file in 8 MiB chunks: a long run's journal can exceed the maximum JS string size.
 *  Calls onLine for each line (the unterminated tail last) and returns the SHA-256 of ALL file bytes. */
function streamLines(file: string, onLine: (line: string, last: boolean) => void): string {
  const fd = openSync(file, 'r'); const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(8 * 1024 * 1024); let carry: Buffer[] = [];
  try {
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null); if (read === 0) break;
      const data = chunk.subarray(0, read); hash.update(data);
      let start = 0;
      for (let at = data.indexOf(10, start); at !== -1; at = data.indexOf(10, start)) {
        carry.push(Buffer.from(data.subarray(start, at)));
        onLine(Buffer.concat(carry).toString('utf8'), false); carry = []; start = at + 1;
      }
      if (start < read) carry.push(Buffer.from(data.subarray(start)));
    }
  } finally { closeSync(fd); }
  onLine(Buffer.concat(carry).toString('utf8'), true);
  return hash.digest('hex');
}
/** B's JSONL snapshots or A's original publish JSONL; no latency/DELIVERED verdict is trusted as data correctness. */
export function loadRunArtifacts(location: string, legacy = false): VerificationRun {
  const byId = new Map<string, RunRecord>(); let torn = false; let legacyRun: string | undefined;
  const journalSha = streamLines(legacy ? location : join(location, 'per-result.jsonl'), (line, last) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch { if (last && !legacy) { torn = true; return; } throw new Error('MALFORMED_RUN_JSONL'); }
    if (!object(parsed)) throw new Error('INVALID_RUN_JSONL');
    if (legacy && parsed.type === 'summary') return;
    if (legacy) {
      if (typeof parsed.run_id !== 'string' || !parsed.run_id || (legacyRun && legacyRun !== parsed.run_id)) throw new Error('MIXED_RUN_IDS');
      legacyRun = parsed.run_id;
    }
    const item = record(parsed, legacy);
    if (legacy && byId.has(item.result_id)) throw new Error('DUPLICATE_PUBLISH_RECORD');
    byId.set(item.result_id, item);
  });
  if (legacy) {
    if (!legacyRun) throw new Error('MISSING_RUN_ID');
    return { run_id: legacyRun, result_ids: [...byId.keys()], selection_complete: false, records: [...byId.values()],
      incomplete: true, input_checksums: { publish_jsonl: journalSha } };
  }
  const manifestText = readFileSync(join(location, 'run-manifest.json'), 'utf8');
  const manifest: unknown = JSON.parse(manifestText);
  if (!object(manifest) || manifest.schema_version !== 1 || typeof manifest.run_id !== 'string' || !manifest.run_id
    || !Array.isArray(manifest.result_ids) || !manifest.result_ids.every((id) => typeof id === 'string')
    || new Set(manifest.result_ids).size !== manifest.result_ids.length
    || manifest.selection_hash !== sha256(JSON.stringify(manifest.result_ids))
    || [...byId.keys()].some((id) => !(manifest.result_ids as string[]).includes(id))) throw new Error('INVALID_MEASUREMENT_MANIFEST');
  return { run_id: manifest.run_id, result_ids: manifest.result_ids as string[], selection_complete: true,
    records: [...byId.values()], incomplete: torn || manifest.ended === null || manifest.stop_reason !== 'completed',
    input_checksums: { run_manifest: sha256(manifestText), per_result_jsonl: journalSha } };
}
