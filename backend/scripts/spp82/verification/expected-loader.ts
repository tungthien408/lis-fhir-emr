import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decimalKey, instantKey, object, uuid } from './exact-values.js';
import type { ExpectedResult, FrozenReference, PatientLink, ReferenceRules } from './verification-types.js';
export const sha256 = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');
export class ReferenceError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ReferenceError'; }
}
const requireReference = (condition: unknown, code: string): void => { if (!condition) throw new ReferenceError(code); };
export function loadExpected(manifestPath: string, pinnedManifestSha256: string): FrozenReference {
  try {
    const bytes = readFileSync(manifestPath);
    requireReference(/^[0-9a-f]{64}$/.test(pinnedManifestSha256) && sha256(bytes) === pinnedManifestSha256, 'MANIFEST_CHECKSUM_MISMATCH');
    const manifest: unknown = JSON.parse(bytes.toString('utf8'));
    if (!object(manifest) || manifest.schema_version !== 1 || manifest.population !== 1000 || !object(manifest.files)
      || !object(manifest.provenance)) throw new ReferenceError('INVALID_REFERENCE_MANIFEST');
    const provenance = manifest.provenance;
    requireReference(provenance.kind === 'handoff-oracle-crosschecked-against-raw-csv-and-versioned-seed'
      && provenance.source_rows_crosschecked === 1000 && provenance.patient_links_crosschecked === 100
      && object(provenance.sources) && Object.keys(provenance.sources).length >= 4
      && Object.values(provenance.sources).every((hash) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
      && Array.isArray(provenance.limitations) && provenance.limitations.every((v) => typeof v === 'string'), 'INVALID_REFERENCE_PROVENANCE');
    const read = (name: string) => {
      const data = readFileSync(join(dirname(manifestPath), name));
      requireReference(manifest.files && (manifest.files as Record<string, unknown>)[name] === sha256(data), 'REFERENCE_FILE_CHECKSUM_MISMATCH');
      return data.toString('utf8');
    };
    const upstream = read('upstream-answers.csv');
    requireReference(sha256(upstream) === provenance.upstream_sha256, 'UPSTREAM_CHECKSUM_MISMATCH');
    const rules: unknown = JSON.parse(read('rules.json'));
    // Independent contract allowlist: never import the product mapper or namespaces.
    const supportedSystems = object(rules) && (
      (rules.version === 'spp82-independent-mr01-mr09-v1'
        && rules.result_system === 'https://example.org/lis/result' && rules.patient_system === 'https://example.org/lis/patient'
        && rules.test_system === 'https://example.org/lis/test-code')
      || (rules.version === 'spp82-independent-mr01-mr09-v2'
        && rules.result_system === 'urn:uuid:05934370-0df0-5666-8eff-bd5181906b62'
        && rules.patient_system === 'urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4'
        && rules.test_system === 'urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02'));
    if (!object(rules) || !supportedSystems || rules.source_system !== 'lis-demo'
      || rules.seed_tag !== 'DACN-MIMIC22-SOURCE-ALIGNED-V2' || rules.category_system !== 'http://terminology.hl7.org/CodeSystem/observation-category'
      || rules.category_code !== 'laboratory' || rules.subject_type !== 'Patient' || rules.clinical_status !== 'final'
      || rules.source_status !== 'FINAL' || rules.resource_type !== 'Observation' || rules.context_separator !== ' / ') throw new ReferenceError('UNSUPPORTED_REFERENCE_RULES');
    const links: unknown = JSON.parse(read('patient-links.json'));
    if (!Array.isArray(links) || links.length !== 100) throw new ReferenceError('INVALID_PATIENT_LINKS');
    const patientKeys = new Map<string, string>(); const uniqueKeys = new Set<string>();
    for (const link of links) {
      if (!object(link) || link.identifier_system !== rules.patient_system || typeof link.identifier_value !== 'string'
        || !uuid(link.patient_key) || patientKeys.has(link.identifier_value) || uniqueKeys.has(link.patient_key.toLowerCase())) throw new ReferenceError('INVALID_PATIENT_LINKS');
      patientKeys.set(link.identifier_value, link.patient_key.toLowerCase()); uniqueKeys.add(link.patient_key.toLowerCase());
    }
    const results: unknown[] = read('expected.jsonl').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown);
    requireReference(results.length === 1000, 'EXPECTED_POPULATION_MUST_BE_1000');
    const ids = new Set<string>(); const sourceIds = new Set<string>();
    for (const row of results) {
      if (!object(row)) throw new ReferenceError('INVALID_EXPECTED_ROW');
      for (const key of ['result_id','source_labevent_id','patient_id','patient_key','test_code','test_name','unit','context']) {
        requireReference(typeof row[key] === 'string' && (row[key] as string).length > 0, 'INVALID_EXPECTED_ROW');
      }
      requireReference(row.result_id === `MIMIC-LAB-${row.source_labevent_id}` && !ids.has(row.result_id as string)
        && !sourceIds.has(row.source_labevent_id as string), 'DUPLICATE_OR_INVALID_SOURCE_IDENTITY');
      requireReference(decimalKey(row.value_num) !== undefined && (row.low === null || decimalKey(row.low) !== undefined)
        && (row.high === null || decimalKey(row.high) !== undefined) && instantKey(row.effective_at) !== undefined
        && row.result_status === 'FINAL', 'INVALID_EXPECTED_CLINICAL_VALUE');
      requireReference((row.fluid === null || typeof row.fluid === 'string') && (row.category === null || typeof row.category === 'string')
        && row.context === [row.test_name, row.fluid, row.category].filter((v) => typeof v === 'string' && v.trim()).join(' / '), 'INVALID_EXPECTED_CONTEXT');
      requireReference(uuid(row.patient_key) && patientKeys.get(row.patient_id as string) === row.patient_key.toLowerCase(), 'EXPECTED_PATIENT_LINK_MISMATCH');
      ids.add(row.result_id as string); sourceIds.add(row.source_labevent_id as string);
    }
    return { manifest_sha256: pinnedManifestSha256, population: 1000, results: results as ExpectedResult[], patient_links: links as PatientLink[],
      rules: rules as unknown as ReferenceRules, provenance, limitations: provenance.limitations as string[] };
  } catch (error) {
    if (error instanceof ReferenceError) throw error;
    throw new ReferenceError(error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'FROZEN_ORACLE_UNAVAILABLE' : 'INVALID_REFERENCE_INPUT');
  }
}
