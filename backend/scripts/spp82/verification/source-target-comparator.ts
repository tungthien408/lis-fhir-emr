import { ExactNumber, equalDecimal, equalInstant, equalTree, equalUuid, object, parseExactJson, path, uuid } from './exact-values.js';
import type { EvidenceSnapshot, ExpectedResult, FieldComparison, FrozenReference, Outcome, ResultVerification, Row, TableName, VerificationRun } from './verification-types.js';
const NA = Symbol('not applicable');
class Unavailable { constructor(readonly reason: string) {} }
type Value = unknown | typeof NA;
const visible = (v: Value): unknown => v === NA ? { not_applicable: true } : v instanceof Unavailable
  ? { not_verified: v.reason } : v === undefined ? { absent: true } : v;
const aggregate = (rows: { outcome: Outcome }[]): Outcome => rows.some((r) => r.outcome === 'FAIL') ? 'FAIL'
  : rows.some((r) => r.outcome === 'NOT_VERIFIED') ? 'NOT_VERIFIED' : 'PASS';
function rows(snapshot: EvidenceSnapshot | null, name: TableName): Row[] | null {
  const table = snapshot?.tables[name]; return table?.status === 'available' ? table.rows : null;
}
function parsedFhir(row: Row | null, reason: string): unknown {
  if (!row) return new Unavailable(reason);
  if (typeof row.fhir_text !== 'string') return new Unavailable('FHIR_NOT_PERSISTED_AS_TEXT');
  try { return parseExactJson(row.fhir_text); } catch { return { invalid_fhir_json: true }; }
}
function field(value: unknown, name: string): unknown { return value instanceof Unavailable ? value : path(value, name); }
function expectedFhir(e: ExpectedResult, reference: FrozenReference): Row {
  const r = reference.rules;
  const quantity = (value: string) => ({ value: new ExactNumber(value), unit: e.unit });
  return {
    resourceType: r.resource_type, identifier: [{ system: r.result_system, value: e.result_id }], status: r.clinical_status,
    category: [{ coding: [{ system: r.category_system, code: r.category_code }] }],
    code: { coding: [{ system: r.test_system, code: e.test_code, display: e.test_name }], text: e.context },
    subject: { type: r.subject_type, identifier: { system: r.patient_system, value: e.patient_id } },
    effectiveDateTime: e.effective_at, valueQuantity: quantity(e.value_num),
    ...(e.low === null && e.high === null ? {} : { referenceRange: [{ ...(e.low === null ? {} : { low: quantity(e.low) }),
      ...(e.high === null ? {} : { high: quantity(e.high) }) }] }),
  };
}
function receipts(snapshot: EvidenceSnapshot | null, exchangeIds: string[]): Row[] | null {
  const all = rows(snapshot, 'send_receipts');
  if (all === null) return null;
  return all.filter((r) => exchangeIds.some((id) => equalUuid(id, r.exchange_id))).map((r) => {
    try { const parsed: unknown = JSON.parse(String(r.receipt_text)); return object(parsed) ? { ...parsed, http_status: r.http_status } : {}; }
    catch { return {}; }
  });
}
export interface VerificationOutput { results: ResultVerification[]; run_fields: FieldComparison[]; limitations: string[]; observed_result_count: number | null; observed_namespace_rows: number | null }
/** Independent MR01–MR09 comparisons. Inputs come from a checked frozen oracle, never Mapper output. */
export function compareDataset(reference: FrozenReference, run: VerificationRun, after: EvidenceSnapshot | null,
  before: EvidenceSnapshot | null): VerificationOutput {
  const resultIds = new Set(reference.results.map((r) => r.result_id));
  const runRecords = new Map(run.records.map((r) => [r.result_id, r]));
  const scopeMatches = (snapshot: EvidenceSnapshot | null) => snapshot !== null
    && snapshot.oracle_manifest_sha256 === reference.manifest_sha256
    && snapshot.scope.source_system === reference.rules.source_system && snapshot.scope.result_system === reference.rules.result_system
    && snapshot.scope.seed_tag === reference.rules.seed_tag && snapshot.scope.coverage === 'namespace-and-expected-identities';
  const afterValid = scopeMatches(after) && after?.phase === 'after' && after.run_id === run.run_id;
  const beforeValid = scopeMatches(before) && before?.phase === 'before'
    && (before.run_id === null || before.run_id === run.run_id) && before.environment_id === after?.environment_id;
  const actual = afterValid ? after : null; const baseline = beforeValid ? before : null;
  const runFields: FieldComparison[] = [];
  const runField = (name: string, expected: unknown, actual: unknown, outcome: Outcome, reason: string) => runFields.push({
    run_id: run.run_id, result_id: null, exchange_id: null, rule_id: 'SCOPE', field_path: name,
    expected, actual_source: null, actual_fhir: null, actual_target: actual, outcome, reason,
  });
  runField('evidence.after_scope', run.run_id, after?.run_id ?? null, afterValid ? 'PASS' : 'NOT_VERIFIED', afterValid ? 'MATCH' : 'AFTER_SCOPE_UNAVAILABLE_OR_MISMATCH');
  runField('evidence.before_scope', reference.manifest_sha256, before?.oracle_manifest_sha256 ?? null,
    beforeValid ? 'PASS' : 'NOT_VERIFIED', beforeValid ? 'MATCH' : 'BASELINE_UNAVAILABLE_OR_MISMATCH');
  runField('run.selected_ids', 'subset of frozen population', run.result_ids.filter((id) => !resultIds.has(id)),
    run.result_ids.some((id) => !resultIds.has(id)) ? 'FAIL' : 'PASS', 'CHECK_SELECTED_IDENTITIES');
  const allTargets = rows(actual, 'emr_results'); const allExchanges = rows(actual, 'exchanges');
  const targetOwners = new Map<string, Set<string>>();
  const own = (key: unknown, id: unknown) => {
    if (!uuid(key) || typeof id !== 'string') return;
    const owners = targetOwners.get(key.toLowerCase()) ?? new Set<string>(); owners.add(id); targetOwners.set(key.toLowerCase(), owners);
  };
  for (const row of allTargets ?? []) own(row.target_id, row.external_id);
  for (const ex of allExchanges ?? []) {
    for (const receipt of receipts(actual, [String(ex.exchange_id)]) ?? []) own(receipt.target_id, ex.source_result_id);
  }
  const results: ResultVerification[] = reference.results.map((e) => {
    const ls = rows(actual, 'lis_results')?.filter((r) => r.result_id === e.result_id) ?? null;
    const xs = allExchanges?.filter((r) => r.source_result_id === e.result_id) ?? null;
    const ps = rows(actual, 'publish_events')?.filter((r) => r.result_id === e.result_id) ?? null;
    const rs = receipts(actual, xs?.map((r) => String(r.exchange_id)) ?? []);
    const targetIds = rs?.map((r) => r.target_id).filter(uuid) ?? [];
    const ts = allTargets?.filter((r) => r.external_id === e.result_id || targetIds.some((id) => equalUuid(id, r.target_id))) ?? null;
    const source = ls?.length === 1 ? ls[0] : null; const ex = xs?.length === 1 ? xs[0] : null;
    const destination = ts?.length === 1 ? ts[0] : null;
    const fhir = parsedFhir(ex, 'MIDDLEWARE_MISSING_OR_AMBIGUOUS');
    const targetFhir = parsedFhir(destination, 'EMR_MISSING_OR_AMBIGUOUS');
    const s = (key: string) => source ? source[key] : new Unavailable('LIS_MISSING_OR_AMBIGUOUS');
    const t = (key: string) => destination ? destination[key] : new Unavailable('EMR_MISSING_OR_AMBIGUOUS');
    const fields: FieldComparison[] = [];
    const add = (rule: string, name: string, expected: unknown, aSource: Value, aFhir: Value, aTarget: Value,
      equal: (expected: unknown, value: unknown, stage: number) => boolean = (a, b) => a === b) => {
      const values = [aSource, aFhir, aTarget];
      const failed = values.some((v, i) => v !== NA && !(v instanceof Unavailable) && !equal(expected, v, i));
      const unavailable = values.filter((v): v is Unavailable => v instanceof Unavailable);
      fields.push({ run_id: run.run_id, result_id: e.result_id, exchange_id: uuid(ex?.exchange_id) ? ex.exchange_id : null,
        rule_id: rule, field_path: name, expected: visible(expected), actual_source: visible(aSource), actual_fhir: visible(aFhir), actual_target: visible(aTarget),
        outcome: failed ? 'FAIL' : unavailable.length ? 'NOT_VERIFIED' : 'PASS',
        reason: failed ? 'VALUE_OR_STRUCTURE_MISMATCH' : unavailable.length ? [...new Set(unavailable.map((v) => v.reason))].join(';') : 'MATCH' });
    };
    const special = (rule: string, name: string, expected: unknown, actual: unknown, outcome: Outcome, reason: string) => {
      fields.push({ run_id: run.run_id, result_id: e.result_id, exchange_id: uuid(ex?.exchange_id) ? ex.exchange_id : null,
        rule_id: rule, field_path: name, expected, actual_source: null, actual_fhir: null, actual_target: visible(actual), outcome, reason });
    };
    for (const [name, list] of [['lis', ls], ['exchange', xs], ['emr', ts]] as const) {
      special('CARDINALITY', `${name}.count`, 1, list?.length ?? null, list === null ? 'NOT_VERIFIED' : list.length === 1 ? 'PASS' : 'FAIL',
        list === null ? 'TABLE_UNAVAILABLE' : list.length === 0 ? 'MISSING_RESULT' : list.length > 1 ? 'DUPLICATE_RESULT' : 'MATCH');
    }
    add('MR01', 'result_id', e.result_id, s('result_id'), field(fhir, 'identifier.0.value'), t('external_id'));
    add('MR01', 'external_system', reference.rules.result_system, NA, field(fhir, 'identifier.0.system'), t('external_system'));
    add('MR01', 'source_labevent_id', e.source_labevent_id, s('source_labevent_id'), NA, NA);
    add('MR01', 'seed_tag', reference.rules.seed_tag, s('seed_tag'), NA, NA);
    add('MR02', 'patient.identifier.value', e.patient_id, s('patient_id'), field(fhir, 'subject.identifier.value'), field(targetFhir, 'subject.identifier.value'));
    add('MR02', 'patient.identifier.system', reference.rules.patient_system, NA, field(fhir, 'subject.identifier.system'), field(targetFhir, 'subject.identifier.system'));
    add('MR02', 'patient.subject_type', 'Patient', NA, field(fhir, 'subject.type'), field(targetFhir, 'subject.type'));
    const links = rows(actual, 'patient_links')?.filter((r) => r.identifier_system === reference.rules.patient_system && r.identifier_value === e.patient_id) ?? null;
    special('MR02', 'patient_link.count', 1, links?.length ?? null, links === null ? 'NOT_VERIFIED' : links.length === 1 ? 'PASS' : 'FAIL',
      links === null ? 'PATIENT_LINKS_UNAVAILABLE' : links.length === 1 ? 'MATCH' : 'MISSING_OR_DUPLICATE_PATIENT_LINK');
    add('MR02', 'patient_key', e.patient_key, links?.length === 1 ? links[0].patient_key : new Unavailable('NO_UNIQUE_PATIENT_LINK'), NA, t('patient_key'), equalUuid);
    const patientRows = rows(actual, 'emr_patients');
    special('MR02', 'emr_patient.exists', true, patientRows?.some((r) => equalUuid(r.patient_key, e.patient_key)) ?? null,
      patientRows === null ? 'NOT_VERIFIED' : patientRows.some((r) => equalUuid(r.patient_key, e.patient_key)) ? 'PASS' : 'FAIL',
      patientRows === null ? 'PATIENTS_UNAVAILABLE' : 'FROZEN_PATIENT_KEY_MUST_EXIST');
    add('MR03', 'test.code', e.test_code, s('test_code'), field(fhir, 'code.coding.0.code'), t('analyte_code'));
    add('MR03', 'test.system', reference.rules.test_system, NA, field(fhir, 'code.coding.0.system'), t('analyte_system'));
    add('MR03', 'test.display', e.test_name, s('test_name'), field(fhir, 'code.coding.0.display'), t('analyte_display'));
    const numeric = (expected: unknown, value: unknown, stage: number) => stage === 1
      ? value instanceof ExactNumber && equalDecimal(expected, value.lexeme) : equalDecimal(expected, value);
    add('MR04', 'quantity', e.value_num, s('value_num'), field(fhir, 'valueQuantity.value'), t('quantity'), numeric);
    add('MR05', 'unit', e.unit, s('unit'), field(fhir, 'valueQuantity.unit'), t('unit_text'));
    for (const bound of ['low', 'high'] as const) {
      const expected = e[bound];
      add('MR06', `reference.${bound}`, expected, s(`reference_${bound}`),
        field(fhir, `referenceRange.0.${bound}${expected === null ? '' : '.value'}`), t(bound),
        (want, value, stage) => want === null ? stage === 1 ? value === undefined : value === null : numeric(want, value, stage));
    }
    add('MR07', 'effective_at', e.effective_at, s('effective_at'), field(fhir, 'effectiveDateTime'), t('effective_at'), equalInstant);
    add('MR08', 'source_status', 'FINAL', s('result_status'), NA, NA);
    add('MR08', 'clinical_status', 'final', NA, field(fhir, 'status'), t('clinical_status'));
    add('MR09', 'context', e.context, NA, field(fhir, 'code.text'), t('analyte_context'));
    add('MR09', 'source.fluid', e.fluid, s('fluid'), NA, NA);
    add('MR09', 'source.category', e.category, s('category'), NA, NA);
    add('MR09', 'laboratory.category', reference.rules.category_code, NA, field(fhir, 'category.0.coding.0.code'), field(targetFhir, 'category.0.coding.0.code'));
    add('FHIR', 'fhir.supported_structure', expectedFhir(e, reference), NA, fhir, targetFhir, (want, value) => equalTree(want, value));
    special('PIPELINE', 'middleware.status', 'DELIVERED', ex?.status ?? null,
      !ex ? 'NOT_VERIFIED' : ex.status === 'DELIVERED' ? 'PASS' : ['FAILED','REJECTED'].includes(String(ex.status)) ? 'FAIL' : 'NOT_VERIFIED',
      ex?.status === 'DELIVERED' ? 'MATCH' : 'DELIVERY_NOT_ESTABLISHED');
    special('CARDINALITY', 'target_id.unique', true, destination?.target_id ?? null,
      !destination ? 'NOT_VERIFIED' : uuid(destination.target_id) && (targetOwners.get(destination.target_id.toLowerCase())?.size ?? 0) === 1 ? 'PASS' : 'FAIL',
      !destination ? 'NO_UNIQUE_DESTINATION' : 'TARGET_MUST_BELONG_TO_ONE_SOURCE');
    // Run attribution uses event identity + a pre-run absence snapshot + actual SEND receipt.
    // It never subtracts server clocks or counts DELIVERED/old EMR content as current-run proof.
    const record = runRecords.get(e.result_id); const pub = ps?.length === 1 ? ps[0] : null;
    const preTargets = rows(baseline, 'emr_results'); const preEvents = rows(baseline, 'publish_events'); const preExchanges = rows(baseline, 'exchanges');
    const stale = record?.publication === 'EXISTING'
      || preTargets?.some((r) => r.external_id === e.result_id || (destination && equalUuid(r.target_id, destination.target_id)))
      || preEvents?.some((r) => r.result_id === e.result_id) || preExchanges?.some((r) => r.source_result_id === e.result_id);
    let attribution: Outcome; let reason: string;
    if (stale) { attribution = 'FAIL'; reason = 'PREVIOUSLY_EXISTING_RESULT_OR_EVENT'; }
    else if (!record || !run.result_ids.includes(e.result_id) || record.publication !== 'NEW' || !uuid(record.event_id)) {
      attribution = 'NOT_VERIFIED'; reason = 'NO_CURRENT_NEW_PUBLICATION_EVIDENCE';
    } else if (!preTargets || !preEvents || !preExchanges || !pub || !ex || !destination || rs === null) {
      attribution = 'NOT_VERIFIED'; reason = 'BASELINE_OR_CURRENT_LINK_EVIDENCE_MISSING';
    } else if (!equalUuid(pub.event_id, record.event_id) || !equalUuid(ex.event_id, record.event_id)
      || !equalUuid(pub.exchange_id, ex.exchange_id) || (record.exchange_id !== null && !equalUuid(record.exchange_id, ex.exchange_id))
      || ex.source_system !== reference.rules.source_system || pub.source_system !== reference.rules.source_system) {
      attribution = 'FAIL'; reason = 'CURRENT_EVENT_EXCHANGE_MISMATCH';
    } else {
      const confirmed = rs.some((r) => ((r.http_status === 201 && r.result === 'STORED') || (r.http_status === 200 && r.result === 'ALREADY_EXISTS'))
        && r.external_system === reference.rules.result_system && r.external_id === e.result_id
        && equalUuid(r.patient_key, e.patient_key) && equalUuid(r.target_id, destination.target_id));
      attribution = confirmed ? 'PASS' : rs.length ? 'FAIL' : 'NOT_VERIFIED';
      reason = confirmed ? 'NEW_EVENT_BASELINE_ABSENCE_AND_RECEIPT_MATCH' : 'NO_MATCHING_STORAGE_RECEIPT';
    }
    special('RUN', 'current_run.attribution', 'new publication + absence before + matching persisted receipt',
      { publication: record?.publication ?? null, event_id: record?.event_id ?? null }, attribution, reason);
    return { result_id: e.result_id, outcome: aggregate(fields), measurement_outcome: record?.outcome ?? null, fields };
  });
  // Namespace delta defines extra rows within the experiment scope; baseline rows are not falsely called run extras.
  for (const [table, identity, sourceId] of [['lis_results','result_id','result_id'], ['exchanges','exchange_id','source_result_id'], ['emr_results','target_id','external_id']] as const) {
    const post = rows(actual, table); const pre = rows(baseline, table);
    if (!post || !pre) { runField(`${table}.unexpected_extras`, 0, null, 'NOT_VERIFIED', 'NAMESPACE_DELTA_UNAVAILABLE'); continue; }
    const old = new Set(pre.map((r) => r[identity]));
    const selected = new Set(run.result_ids);
    const extras = post.filter((r) => (!resultIds.has(String(r[sourceId]))
      || (run.selection_complete && !selected.has(String(r[sourceId])))) && !old.has(r[identity]));
    runField(`${table}.unexpected_extras`, 0, extras.map((r) => ({ id: r[identity], source_id: r[sourceId] })), extras.length ? 'FAIL' : 'PASS', extras.length ? 'UNEXPECTED_NEW_ROWS_IN_SCOPE' : 'MATCH');
  }
  const expectedTargetIds = new Set<string>();
  for (const ex of allExchanges ?? []) if (resultIds.has(String(ex.source_result_id))) {
    for (const receipt of receipts(actual, [String(ex.exchange_id)]) ?? []) if (uuid(receipt.target_id)) expectedTargetIds.add(receipt.target_id.toLowerCase());
  }
  return { results, run_fields: runFields,
    observed_result_count: allTargets?.filter((r) => resultIds.has(String(r.external_id)) || (uuid(r.target_id) && expectedTargetIds.has(r.target_id.toLowerCase()))).length ?? null,
    observed_namespace_rows: allTargets?.length ?? null, limitations: [...reference.limitations,
    'Snapshots are repeatable-read per service, not one simultaneous cross-service snapshot.',
    'Current-run proof assumes an approved isolated harness with no competing writer for selected identities.',
    ...(run.selection_complete ? [] : ['82-A output alone does not enumerate unscheduled selected IDs.']),
    ...(run.incomplete ? ['Measurement run incomplete/timeout: verification concerns saved state, not latency completion.'] : [])] };
}
