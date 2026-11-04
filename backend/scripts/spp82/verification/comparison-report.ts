import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldComparison, FrozenReference, Outcome } from './verification-types.js';
import type { VerificationOutput } from './source-target-comparator.js';
export function summarizeComparisons(output: VerificationOutput, expectedPopulation = 1000) {
  const fields = [...output.run_fields, ...output.results.flatMap((r) => r.fields)];
  const perField: Record<string, Record<Outcome, number>> = Object.create(null) as Record<string, Record<Outcome, number>>;
  for (const row of fields) {
    const key = `${row.rule_id}:${row.field_path}`;
    perField[key] ??= { PASS: 0, FAIL: 0, NOT_VERIFIED: 0 }; perField[key][row.outcome]++;
  }
  const has = (rule: (field: FieldComparison) => boolean) => output.results.filter((r) => r.fields.some(rule)).length;
  const extra = (table: string) => {
    const field = output.run_fields.find((f) => f.field_path === `${table}.unexpected_extras`);
    return Array.isArray(field?.actual_target) ? field.actual_target.length : null;
  };
  const matched = output.results.filter((r) => r.outcome === 'PASS').length;
  return {
    total_expected_results: expectedPopulation, total_observed_results: output.observed_result_count,
    observed_namespace_rows: output.observed_namespace_rows, matched_result_count: matched,
    match_rate: matched / expectedPopulation,
    missing_result_count: has((f) => f.field_path === 'emr.count' && f.actual_target === 0),
    duplicate_result_count: has((f) => f.field_path === 'emr.count' && typeof f.actual_target === 'number' && f.actual_target > 1),
    source_cardinality_failure_count: has((f) => f.field_path === 'lis.count' && f.outcome === 'FAIL'),
    wrong_patient_linkage_count: has((f) => f.rule_id === 'MR02' && f.outcome === 'FAIL'),
    field_mismatch_result_count: has((f) => (f.rule_id.startsWith('MR') || f.rule_id === 'FHIR') && f.outcome === 'FAIL'),
    stale_result_count: has((f) => f.reason === 'PREVIOUSLY_EXISTING_RESULT_OR_EVENT'),
    reused_target_count: has((f) => f.field_path === 'target_id.unique' && f.outcome === 'FAIL'),
    unverified_result_count: expectedPopulation - output.results.length + has((f) => f.outcome === 'NOT_VERIFIED'),
    failed_result_count: output.results.filter((r) => r.outcome === 'FAIL').length,
    unexpected_extra_result_count: extra('emr_results'), unexpected_extra_source_count: extra('lis_results'),
    unexpected_extra_exchange_count: extra('exchanges'),
    outcome: fields.some((f) => f.outcome === 'FAIL') ? 'FAIL' : fields.some((f) => f.outcome === 'NOT_VERIFIED') || matched !== expectedPopulation ? 'NOT_VERIFIED' : 'PASS',
    per_field: perField,
  };
}
export function writeComparisonReport(directory: string, runId: string, reference: FrozenReference | null,
  output: VerificationOutput, inputChecksums: Record<string, string>) {
  mkdirSync(directory, { mode: 0o700 });
  const write = (name: string, data: string) => writeFileSync(join(directory, name), data, { mode: 0o600, flag: 'wx' });
  const summary = summarizeComparisons(output);
  const report = { schema_version: 1, tool_version: 'spp82-independent-verification-v1', run_id: runId,
    oracle_manifest_sha256: reference?.manifest_sha256 ?? null, simulated: reference?.provenance.synthetic === true, input_checksums: inputChecksums,
    ...summary, limitations: output.limitations };
  write('comparison-report.json', JSON.stringify(report, null, 2) + '\n');
  write('field-comparisons.jsonl', [...output.run_fields, ...output.results.flatMap((r) => r.fields)].map((f) => JSON.stringify(f)).join('\n') + '\n');
  write('per-result-verification.jsonl', output.results.map(({ result_id, outcome, measurement_outcome, fields }) => JSON.stringify({
    run_id: runId, result_id, outcome, measurement_outcome, failed_fields: fields.filter((f) => f.outcome === 'FAIL').map((f) => f.field_path),
    unverified_fields: fields.filter((f) => f.outcome === 'NOT_VERIFIED').map((f) => f.field_path),
  })).join('\n') + '\n');
  write('summary.md', `# SPP-82-C — Kiểm chứng độc lập${reference?.provenance.synthetic === true ? ' — SIMULATED' : ''}\n\nRun: ${JSON.stringify(runId)}. Kết luận: **${summary.outcome}**.\n\n`
    + `Mẫu số: **${summary.total_expected_results}**; quan sát được trong tập expected: ${summary.total_observed_results ?? 'chưa xác minh'}; khớp đầy đủ và thuộc run hiện tại: ${summary.matched_result_count}.\n\n`
    + `Thiếu: ${summary.missing_result_count}; trùng: ${summary.duplicate_result_count}; sai liên kết bệnh nhân: ${summary.wrong_patient_linkage_count}; sai trường: ${summary.field_mismatch_result_count}; dữ liệu cũ: ${summary.stale_result_count}; chưa xác minh: ${summary.unverified_result_count}. Các nhóm có thể giao nhau.\n\n`
    + `PASS cần cả dữ liệu đúng và bằng chứng thuộc run. FAIL là sai lệch trong bằng chứng đã đọc. NOT_VERIFIED là thiếu/bất khả truy cập bằng chứng; không tính thành công. DELIVERED không thay thế đáp án độc lập.\n\n`
    + `Số thập phân so hệ số/số mũ chính xác; FHIR numeric giữ token JSON. Timestamp so instant Gregorian và toàn bộ phần lẻ giây. Chỉ kiểm subset FHIR của dự án.\n\n`
    + `## Giới hạn\n\n${output.limitations.map((value) => '- ' + value).join('\n')}\n`);
  return report;
}
export function unavailableReport(reason: string): VerificationOutput {
  return { results: [], observed_result_count: null, observed_namespace_rows: null,
    run_fields: [{ run_id: 'UNAVAILABLE', result_id: null, exchange_id: null, rule_id: 'EVIDENCE', field_path: 'verification.inputs',
      expected: 'frozen 1000-row oracle and saved run/database evidence', actual_source: null, actual_fhir: null, actual_target: null,
      outcome: 'NOT_VERIFIED', reason }], limitations: [reason, 'No successful verification is claimed; expected denominator remains 1000.'] };
}
