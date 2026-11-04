import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { compareDataset } from './source-target-comparator.js';
import { summarizeComparisons, unavailableReport, writeComparisonReport } from './comparison-report.js';
import { decimalKey, equalDecimal, equalInstant, ExactNumber, parseExactJson } from './exact-values.js';
import { loadExpected, sha256, ReferenceError } from './expected-loader.js';
import { loadRunArtifacts, loadEvidence } from './evidence-loader.js';
import { captureEvidence, type Reader } from './evidence-collector.js';
import { syntheticFixture } from './synthetic-fixtures.js';
import type { Row, TableName } from './verification-types.js';
const referenceDir = new URL('../reference/spp65-v2/', import.meta.url);
const manifestFile = new URL('manifest.json', referenceDir);
const pinned = readFileSync(new URL('manifest.sha256', referenceDir), 'utf8').trim();
const temp = () => mkdtempSync(join(tmpdir(), 'spp82c-test-'));
function data(f: ReturnType<typeof syntheticFixture>, table: TableName, before = false): Row[] {
  const evidence = (before ? f.before : f.after).tables[table]; assert.equal(evidence.status, 'available');
  return evidence.status === 'available' ? evidence.rows : [];
}
const evaluate = (f: ReturnType<typeof syntheticFixture>) => compareDataset(f.reference, f.run, f.after, f.before);
const has = (f: ReturnType<typeof syntheticFixture>, name: string, outcome = 'FAIL') =>
  evaluate(f).results[0].fields.some((r) => r.field_path === name && r.outcome === outcome);

test('C: exact independent source/FHIR/target match with baseline and receipt', () => {
  const f = syntheticFixture(); assert.equal(evaluate(f).results[0].outcome, 'PASS');
  assert.ok(has(f, 'current_run.attribution', 'PASS'));
});
test('C: missing destination is FAIL, not HTTP success or absent-row PASS', () => {
  const f = syntheticFixture(); f.after.tables.emr_results = { status: 'available', rows: [] };
  const report = summarizeComparisons(evaluate(f));
  assert.equal(report.missing_result_count, 1); assert.equal(report.matched_result_count, 0);
});
test('C: duplicate destination rows are never collapsed by result ID', () => {
  const f = syntheticFixture(); data(f, 'emr_results').push({ ...data(f, 'emr_results')[0], target_id: '00000000-0000-4000-8000-000000077777' });
  assert.equal(summarizeComparisons(evaluate(f)).duplicate_result_count, 1);
});
test('C: swapped patient keys and wrong namespace detected independently of DELIVERED', () => {
  const f = syntheticFixture(2); data(f, 'emr_results')[0].patient_key = f.expected[1].patient_key;
  assert.ok(has(f, 'patient_key')); assert.equal(summarizeComparisons(evaluate(f)).wrong_patient_linkage_count, 1);
  const g = syntheticFixture(); data(g, 'patient_links')[0].identifier_system = 'urn:wrong:namespace';
  assert.ok(has(g, 'patient_link.count'));
});
test('C: missing patient links and wrong FHIR subject are not accepted', () => {
  const f = syntheticFixture(); data(f, 'patient_links').splice(0, 1); assert.ok(has(f, 'patient_link.count'));
  const g = syntheticFixture(); data(g, 'exchanges')[0].fhir_text = String(data(g, 'exchanges')[0].fhir_text).replace('SYNTHETIC-P-A', 'SYNTHETIC-P-B');
  assert.ok(has(g, 'patient.identifier.value'));
});
test('C: same numeric value under distinct source identities yields two distinct verified results', () => {
  const f = syntheticFixture(2); assert.equal(evaluate(f).results.filter((r) => r.outcome === 'PASS').length, 2);
});
test('C: multiple sources referencing one target are detected', () => {
  const f = syntheticFixture(2); data(f, 'emr_results')[1].target_id = data(f, 'emr_results')[0].target_id;
  assert.ok(summarizeComparisons(evaluate(f)).reused_target_count > 0);
});
for (const [field, value, comparison] of [['analyte_code','WRONG','test.code'], ['unit_text','g/L','unit'],
  ['analyte_display','Wrong display','test.display'], ['analyte_context','Wrong context','context'], ['clinical_status','preliminary','clinical_status']] as const) {
  test(`C: wrong persisted ${field} fails ${comparison}`, () => {
    const f = syntheticFixture(); data(f, 'emr_results')[0][field] = value; assert.ok(has(f, comparison));
  });
}
test('C: decimal discrepancy survives beyond JS float precision, in columns and raw FHIR JSON', () => {
  const f = syntheticFixture(); data(f, 'emr_results')[0].quantity = '3.40000000000000000000000001'; assert.ok(has(f, 'quantity'));
  const g = syntheticFixture(); data(g, 'exchanges')[0].fhir_text = String(data(g, 'exchanges')[0].fhir_text).replace('"value":3.4', '"value":3.40000000000000000000000001');
  assert.ok(has(g, 'quantity')); assert.ok(has(g, 'fhir.supported_structure'));
  const h = syntheticFixture(); data(h, 'emr_results')[0].quantity = 3.4; assert.ok(has(h, 'quantity'));
});
test('C: missing microseconds fail; equivalent timezone instants pass', () => {
  const f = syntheticFixture(); data(f, 'emr_results')[0].effective_at = '2026-01-01T00:00:00.123455Z'; assert.ok(has(f, 'effective_at'));
  data(f, 'emr_results')[0].effective_at = '2025-12-31T19:00:00.123456000-05:00'; assert.ok(has(f, 'effective_at', 'PASS'));
});
for (const bound of ['low', 'high'] as const) test(`C: missing required ${bound} bound fails; independently expected absence passes`, () => {
  const f = syntheticFixture(); data(f, 'emr_results')[0][bound] = null; assert.ok(has(f, `reference.${bound}`));
  f.expected[0][bound] = null; data(f, 'lis_results')[0][`reference_${bound}`] = null;
  for (const table of ['exchanges','emr_results'] as const) {
    const parsed = JSON.parse(String(data(f, table)[0].fhir_text)); delete parsed.referenceRange[0][bound];
    data(f, table)[0].fhir_text = JSON.stringify(parsed);
  }
  assert.equal(evaluate(f).results[0].outcome, 'PASS');
});
test('C: different or extra FHIR coding, invalid resource type and added meta fail supported subset', () => {
  for (const change of [(o: Row) => { o.resourceType = 'DiagnosticReport'; },
    (o: Row) => { (o.code as { coding: unknown[] }).coding.push({ system: 'http://loinc.org', code: 'invented' }); },
    (o: Row) => { o.meta = { versionId: '1' }; }]) {
    const f = syntheticFixture(); const o = JSON.parse(String(data(f, 'exchanges')[0].fhir_text)) as Row; change(o);
    data(f, 'exchanges')[0].fhir_text = JSON.stringify(o); assert.ok(has(f, 'fhir.supported_structure'));
  }
});
test('C: independently check stored FHIR, not only flattened EMR columns', () => {
  const f = syntheticFixture(); data(f, 'emr_results')[0].fhir_text = String(data(f, 'emr_results')[0].fhir_text).replace('"value":3.4', '"value":99');
  assert.ok(has(f, 'fhir.supported_structure')); assert.equal(evaluate(f).results[0].outcome, 'FAIL');
});
test('C: partial/timeout run retains all 1000 expected IDs in denominator', () => {
  const f = syntheticFixture(1000); f.run.result_ids = [f.expected[0].result_id]; f.run.records = f.run.records.slice(0, 1);
  f.run.incomplete = true; f.run.records[0].outcome = 'timeout';
  for (const name of ['publish_events','exchanges','send_receipts','emr_results'] as const) data(f, name).splice(1);
  const report = summarizeComparisons(evaluate(f));
  assert.equal(report.total_expected_results, 1000); assert.equal(report.matched_result_count, 1);
  assert.equal(report.match_rate, .001); assert.equal(report.missing_result_count, 999);
  assert.equal(evaluate(f).results[0].measurement_outcome, 'timeout'); // Later persisted evidence does not rewrite performance history.
});
test('C: full 1000-row synthetic match has denominator 1000, never runs publisher', () => {
  const report = summarizeComparisons(evaluate(syntheticFixture(1000)));
  assert.equal(report.matched_result_count, 1000); assert.equal(report.total_observed_results, 1000); assert.equal(report.outcome, 'PASS');
});
test('C: preexisting EMR rows and events cannot count as current-run success', () => {
  const f = syntheticFixture(); data(f, 'emr_results', true).push({ ...data(f, 'emr_results')[0] });
  assert.equal(summarizeComparisons(evaluate(f)).stale_result_count, 1);
  const g = syntheticFixture(); g.run.records[0].publication = 'EXISTING'; assert.ok(has(g, 'current_run.attribution'));
});
test('C: missing baseline is NOT_VERIFIED even with DELIVERED and perfect data', () => {
  const f = syntheticFixture(); const result = compareDataset(f.reference, f.run, f.after, null);
  assert.equal(result.results[0].outcome, 'NOT_VERIFIED'); assert.equal(summarizeComparisons(result).matched_result_count, 0);
});
test('C: ALREADY_EXISTS after a lost response can belong to this run if baseline was empty', () => {
  const f = syntheticFixture(); const row = data(f, 'send_receipts')[0]; row.http_status = 200;
  row.receipt_text = String(row.receipt_text).replace('STORED', 'ALREADY_EXISTS');
  assert.equal(evaluate(f).results[0].outcome, 'PASS');
});
test('C: extra new namespace rows fail, unrelated baseline rows do not', () => {
  const f = syntheticFixture(); const extra = { ...data(f, 'emr_results')[0], external_id: 'EXTRA-R', target_id: '00000000-0000-4000-8000-000000088888' };
  data(f, 'emr_results').push(extra); assert.equal(summarizeComparisons(evaluate(f)).unexpected_extra_result_count, 1);
  data(f, 'emr_results', true).push(extra); assert.equal(summarizeComparisons(evaluate(f)).unexpected_extra_result_count, 0);
});
test('C: inaccessible tables never turn into empty successful reads', () => {
  const f = syntheticFixture(); f.after.tables.emr_results = { status: 'unavailable', reason: 'NO_PERMISSION' };
  const report = summarizeComparisons(evaluate(f)); assert.equal(report.total_observed_results, null);
  assert.equal(report.missing_result_count, 0); assert.ok(report.unverified_result_count > 0);
});
test('C: mismatched run/environment or current event cannot be attributed', () => {
  const f = syntheticFixture(); f.after.run_id = 'another-run'; assert.equal(evaluate(f).results[0].outcome, 'NOT_VERIFIED');
  const g = syntheticFixture(); g.before.environment_id = 'other'; assert.ok(has(g, 'current_run.attribution', 'NOT_VERIFIED'));
  const h = syntheticFixture(); data(h, 'exchanges')[0].event_id = '00000000-0000-4000-8000-000000055555'; assert.ok(has(h, 'current_run.attribution'));
});
test('C: decimal and Gregorian timestamp edge cases are exact and reject invalid values', () => {
  assert.ok(equalDecimal('003.4000', '34e-1')); assert.ok(equalDecimal('-0.0', '0')); assert.equal(decimalKey('NaN'), undefined);
  assert.equal(equalDecimal('9007199254740993', '9007199254740992'), false);
  assert.ok(equalInstant('2000-03-01T00:00:00Z', '2000-02-29T19:00:00-05:00'));
  assert.equal(equalInstant('1900-02-29T00:00:00Z', '1900-03-01T00:00:00Z'), false);
  assert.equal(equalInstant('2026-01-01T00:00:00.000001Z', '2026-01-01T00:00:00Z'), false);
  assert.equal(equalInstant('2026-01-01T00:00:00+14:01', '2026-01-01T00:00:00Z'), false);
});
test('C: lossless JSON preserves tokens and rejects duplicate keys, trailing commas and number strings', () => {
  const value = parseExactJson('{"n":9007199254740993,"escaped":"a\\\"b"}') as Row;
  assert.ok(value.n instanceof ExactNumber); assert.equal(value.n.lexeme, '9007199254740993');
  assert.throws(() => parseExactJson('{"n":1,"n":2}')); assert.throws(() => parseExactJson('[1,]'));
  assert.throws(() => parseExactJson('{"n":01}')); assert.equal(parseExactJson('"3.4"'), '3.4');
});
test('C: frozen SPP-65 loader validates population, hashes, provenance and 100 patient mappings', () => {
  const ref = loadExpected(manifestFile.pathname, pinned); assert.equal(ref.results.length, 1000); assert.equal(ref.patient_links.length, 100);
  assert.ok(ref.limitations.some((v) => v.includes('Original manifest_1000.csv')));
});
test('C: missing/corrupt oracle is explicit NOT_VERIFIED with denominator 1000', () => {
  assert.throws(() => loadExpected('/tmp/does-not-exist-spp82c-oracle/manifest.json', pinned),
    (e) => e instanceof ReferenceError && e.code === 'FROZEN_ORACLE_UNAVAILABLE');
  assert.throws(() => loadExpected(manifestFile.pathname, '0'.repeat(64)), /MANIFEST_CHECKSUM_MISMATCH/);
  const summary = summarizeComparisons(unavailableReport('FROZEN_ORACLE_UNAVAILABLE'));
  assert.equal(summary.total_expected_results, 1000); assert.equal(summary.unverified_result_count, 1000); assert.equal(summary.outcome, 'NOT_VERIFIED');
});
function mutatedReference(mutate: (dir: string, manifest: Row) => void) {
  const dir = temp(); cpSync(referenceDir, dir, { recursive: true });
  try { const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Row; mutate(dir, manifest);
    const text = JSON.stringify(manifest); writeFileSync(join(dir, 'manifest.json'), text); return loadExpected(join(dir, 'manifest.json'), sha256(text)); }
  finally { rmSync(dir, { recursive: true }); }
}
test('C: shrinking to 999 or duplicating IDs is rejected even with recalculated checksums', () => {
  for (const duplicate of [false, true]) assert.throws(() => mutatedReference((dir, manifest) => {
    const lines = readFileSync(join(dir, 'expected.jsonl'), 'utf8').trim().split('\n');
    if (duplicate) lines[999] = lines[0]; else lines.pop();
    const text = lines.join('\n') + '\n'; writeFileSync(join(dir, 'expected.jsonl'), text);
    (manifest.files as Row)['expected.jsonl'] = sha256(text);
  }), duplicate ? /DUPLICATE_OR_INVALID_SOURCE_IDENTITY/ : /EXPECTED_POPULATION_MUST_BE_1000/);
});
test('C: wrong frozen patient mapping or provenance is rejected', () => {
  assert.throws(() => mutatedReference((_dir, manifest) => { (manifest.provenance as Row).kind = 'copied-from-mapper'; }), /INVALID_REFERENCE_PROVENANCE/);
  assert.throws(() => mutatedReference((dir, manifest) => {
    const links = JSON.parse(readFileSync(join(dir, 'patient-links.json'), 'utf8')) as Row[];
    [links[0].patient_key, links[1].patient_key] = [links[1].patient_key, links[0].patient_key];
    const text = JSON.stringify(links); writeFileSync(join(dir, 'patient-links.json'), text); (manifest.files as Row)['patient-links.json'] = sha256(text);
  }), /EXPECTED_PATIENT_LINK_MISMATCH/);
});
test('C: offline report is byte reproducible and includes all required per-field audit keys', () => {
  const f = syntheticFixture(); data(f, 'emr_results')[0].unit_text = 'wrong'; const output = evaluate(f); const dir = temp();
  try {
    const a = join(dir, 'a'); const b = join(dir, 'b');
    writeComparisonReport(a, f.run.run_id, f.reference, output, { after: 'b'.repeat(64) });
    writeComparisonReport(b, f.run.run_id, f.reference, evaluate(f), { after: 'b'.repeat(64) });
    for (const name of readdirSync(a)) assert.deepEqual(readFileSync(join(a, name)), readFileSync(join(b, name)));
    const row = output.results[0].fields.find((field) => field.field_path === 'unit')!;
    for (const key of ['run_id','result_id','exchange_id','rule_id','field_path','expected','actual_fhir','actual_target','outcome','reason']) assert.ok(key in row);
    assert.equal(row.actual_target, 'wrong'); assert.throws(() => writeComparisonReport(a, f.run.run_id, f.reference, output, {}));
  } finally { rmSync(dir, { recursive: true }); }
});
test('C: load 82-B journal and original 82-A records without trusting their delivery verdict', () => {
  const run = loadRunArtifacts(new URL('../../../../docs/docs_backend/spp-82-b-example/', import.meta.url).pathname);
  assert.equal(run.records.length, 3); assert.equal(run.selection_complete, true);
  const dir = temp(); try {
    const file = join(dir, 'a.jsonl'); writeFileSync(file, JSON.stringify({ run_id: 'A-run', result_id: 'R1', event_id: null,
      publish_outcome: 'ERROR', http_status: null }) + '\n' + JSON.stringify({ type: 'summary', runId: 'A-run' }) + '\n');
    const legacy = loadRunArtifacts(file, true); assert.equal(legacy.selection_complete, false); assert.equal(legacy.records[0].publication, 'ERROR');
  } finally { rmSync(dir, { recursive: true }); }
});
test('C: evidence loader rejects truncated scope and preserves raw numeric JSON strings', () => {
  const f = syntheticFixture(); const dir = temp(); try {
    const file = join(dir, 'after.json'); writeFileSync(file, JSON.stringify(f.after));
    const loaded = loadEvidence(file, f.reference, 'after'); assert.deepEqual(loaded.snapshot, f.after);
    f.after.scope.coverage = 'only-first-page' as never; writeFileSync(file, JSON.stringify(f.after));
    assert.throws(() => loadEvidence(file, f.reference, 'after'), /INVALID_EVIDENCE_SCOPE/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('C: collector uses separate scoped roles, READ ONLY transactions, exact SQL projections and isolation guard', async () => {
  const f = syntheticFixture(); const token = f.after.environment_id; const statements: { role: string; sql: string }[] = [];
  const env = { SPP82_VERIFICATION_ISOLATION_TOKEN: token,
    LIS_VERIFY_DATABASE_URL: 'postgresql://lis_app:secret@127.0.0.1:5555/dacn_db',
    MIDDLEWARE_VERIFY_DATABASE_URL: 'postgresql://integration_app:secret@127.0.0.1:5555/dacn_db',
    EMR_VERIFY_DATABASE_URL: 'postgresql://emr_app:secret@127.0.0.1:5555/dacn_db' };
  const captured = await captureEvidence(f.reference, 'after', f.run.run_id, env, (url): Reader => {
    const role = new URL(url).username;
    return { connect: async () => {}, end: async () => {}, query: async (sql) => {
      statements.push({ role, sql });
      if (sql.includes('FROM pg_database')) return { rows: [{ role, database: 'dacn_db', read_only: 'on', marker: `spp66-disposable:${token}`, server_time: '2026-11-02T00:00:00Z' }] };
      return { rows: [] };
    } };
  });
  assert.ok(Object.values(captured.tables).every((t) => t.status === 'available'));
  assert.equal(statements.filter((s) => s.sql.includes('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')).length, 3);
  assert.ok(statements.some((s) => s.sql.includes('quantity::text'))); assert.ok(statements.some((s) => s.sql.includes('fhir_payload::text')));
  for (const s of statements) {
    if (s.sql.includes('FROM pg_database') || !s.sql.startsWith('SELECT')) continue;
    const allowed = s.role === 'lis_app' ? 'lis' : s.role === 'integration_app' ? 'integration' : 'emr';
    for (const other of ['lis','integration','emr'].filter((v) => v !== allowed)) assert.ok(!s.sql.includes(`${other}.`));
    assert.ok(!/\b(INSERT|UPDATE|DELETE|GRANT|TRUNCATE)\b/.test(s.sql));
  }
  let dataReads = 0;
  const denied = await captureEvidence(f.reference, 'after', f.run.run_id, env, (): Reader => ({ connect: async () => {}, end: async () => {},
    query: async (sql) => { if (sql.includes('FROM pg_database')) return { rows: [{ role: 'postgres', marker: 'wrong' }] };
      if (sql.startsWith('SELECT')) dataReads++; return { rows: [] }; } }));
  assert.equal(dataReads, 0); assert.ok(Object.values(denied.tables).every((t) => t.status === 'unavailable'));
  assert.ok(!JSON.stringify(denied).includes('secret'));
});
test('C: source LIS fields are checked against frozen expected values', () => {
  const f = syntheticFixture(); data(f, 'lis_results')[0].value_num = '3.4000001';
  assert.ok(has(f, 'quantity')); assert.equal(evaluate(f).results[0].outcome, 'FAIL');
});
test('C: a new unselected result in the 1000-result oracle is still an extra in a pilot run', () => {
  const f = syntheticFixture(2); f.run.result_ids = [f.expected[0].result_id]; f.run.records.splice(1);
  const summary = summarizeComparisons(evaluate(f)); assert.equal(summary.unexpected_extra_result_count, 1);
});
test('C: missing required identity or numeric JSON encoded as string cannot pass', () => {
  const f = syntheticFixture(); data(f, 'exchanges')[0].fhir_text = String(data(f, 'exchanges')[0].fhir_text).replace('"value":3.4', '"value":"3.4"');
  assert.ok(has(f, 'quantity')); assert.ok(has(f, 'fhir.supported_structure'));
  const g = syntheticFixture(); delete data(g, 'emr_results')[0].external_system; assert.ok(has(g, 'external_system'));
});

test('C: offline CLI reproduces reports and refuses success without database evidence', () => {
  const dir = temp();
  try {
    const runDir = join(dir, 'run'); cpSync(new URL('../../../../docs/docs_backend/spp-82-b-example/', import.meta.url), runDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));
    manifest.result_ids = []; manifest.selection_hash = sha256('[]'); manifest.run_id = 'SIMULATED-CLI-NO-DATA';
    writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify(manifest)); writeFileSync(join(runDir, 'per-result.jsonl'), '');
    const entry = new URL('./verification-main.ts', import.meta.url).pathname;
    for (const name of ['first','second']) {
      const result = spawnSync(process.execPath, ['--import','tsx',entry,'verify','--oracle',manifestFile.pathname,
        '--oracle-sha256',pinned,'--run-dir',runDir,'--output',join(dir,name)], { encoding: 'utf8' });
      assert.equal(result.status, 2, result.stderr); const summary = JSON.parse(readFileSync(join(dir,name,'comparison-report.json'), 'utf8'));
      assert.equal(summary.total_expected_results, 1000); assert.equal(summary.matched_result_count, 0);
      assert.equal(summary.unverified_result_count, 1000); assert.equal(summary.outcome, 'NOT_VERIFIED');
    }
    for (const name of readdirSync(join(dir, 'first'))) assert.deepEqual(readFileSync(join(dir,'first',name)), readFileSync(join(dir,'second',name)));
    const missing = spawnSync(process.execPath, ['--import','tsx',entry,'verify','--oracle',join(dir,'missing.json'),
      '--oracle-sha256',pinned,'--output',join(dir,'missing-report')], { encoding: 'utf8' });
    assert.equal(missing.status, 2); assert.ok(readFileSync(join(dir,'missing-report','summary.md'), 'utf8').includes('FROZEN_ORACLE_UNAVAILABLE'));
  } finally { rmSync(dir, { recursive: true }); }
});
