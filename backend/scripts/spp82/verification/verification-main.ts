import { readFileSync, writeFileSync } from 'node:fs';
import { loadExpected, ReferenceError, sha256 } from './expected-loader.js';
import { loadEvidence, loadRunArtifacts } from './evidence-loader.js';
import { captureEvidence } from './evidence-collector.js';
import { compareDataset } from './source-target-comparator.js';
import { unavailableReport, writeComparisonReport } from './comparison-report.js';
function argumentsFor(args: string[]) {
  const command = args.shift(); const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!; const value = args.shift();
    if (!['--oracle','--oracle-sha256','--run-dir','--publish-jsonl','--after','--before','--output','--phase'].includes(key)
      || !value || value.startsWith('--') || flags.has(key)) throw new Error('INVALID_ARGUMENTS');
    flags.set(key, value);
  }
  return { command, flags };
}
async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('SPP-82-C (offline by default)\n'
      + 'verify --oracle manifest.json --oracle-sha256 SHA256 --run-dir B-artifacts --after after.json [--before before.json] --output NEW-directory\n'
      + 'verify may use --publish-jsonl A-output.jsonl instead of --run-dir. Missing inputs produce NOT_VERIFIED, never PASS.\n'
      + 'capture --oracle manifest.json --oracle-sha256 SHA256 --phase before|after [--run-dir B-artifacts] --output NEW-evidence.json\n'
      + 'capture requires explicit per-role VERIFY_DATABASE_URLs and SPP82_VERIFICATION_ISOLATION_TOKEN (approved D3 isolated DB).\n'); return;
  }
  const { command, flags } = argumentsFor(process.argv.slice(2));
  const output = flags.get('--output'); if (!output || !['verify','capture'].includes(command ?? '')) throw new Error('INVALID_ARGUMENTS');
  try {
    const reference = loadExpected(flags.get('--oracle') ?? '', flags.get('--oracle-sha256') ?? '');
    if (command === 'capture') {
      const phase = flags.get('--phase'); if (phase !== 'before' && phase !== 'after') throw new Error('INVALID_PHASE');
      const run = flags.has('--run-dir') ? loadRunArtifacts(flags.get('--run-dir')!) : flags.has('--publish-jsonl') ? loadRunArtifacts(flags.get('--publish-jsonl')!, true) : null;
      if (phase === 'after' && !run) throw new Error('AFTER_CAPTURE_REQUIRES_RUN');
      // Exclusive output reservation before contacting any database.
      writeFileSync(output, '', { flag: 'wx', mode: 0o600 });
      const snapshot = await captureEvidence(reference, phase, run?.run_id ?? null, process.env);
      writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
      process.stdout.write(JSON.stringify({ evidence_sha256: sha256(readFileSync(output)), phase }) + '\n');
      if (Object.values(snapshot.tables).some((table) => table.status === 'unavailable')) process.exitCode = 2;
      return;
    }
    if (flags.has('--run-dir') === flags.has('--publish-jsonl')) throw new Error('ONE_RUN_INPUT_REQUIRED');
    const run = flags.has('--run-dir') ? loadRunArtifacts(flags.get('--run-dir')!) : loadRunArtifacts(flags.get('--publish-jsonl')!, true);
    const after = flags.has('--after') ? loadEvidence(flags.get('--after')!, reference, 'after') : null;
    const before = flags.has('--before') ? loadEvidence(flags.get('--before')!, reference, 'before') : null;
    const result = compareDataset(reference, run, after?.snapshot ?? null, before?.snapshot ?? null);
    const report = writeComparisonReport(output, run.run_id, reference, result, { ...run.input_checksums,
      ...(after ? { after: after.checksum } : {}), ...(before ? { before: before.checksum } : {}) });
    process.stdout.write(JSON.stringify({ outcome: report.outcome, expected: report.total_expected_results, matched: report.matched_result_count }) + '\n');
    process.exitCode = report.outcome === 'PASS' ? 0 : report.outcome === 'FAIL' ? 1 : 2;
  } catch (error) {
    if (command === 'capture') throw error;
    const code = error instanceof ReferenceError ? error.code : 'VERIFICATION_INPUT_OR_OUTPUT_UNAVAILABLE';
    writeComparisonReport(output, 'UNAVAILABLE', null, unavailableReport(code), {});
    process.stdout.write(JSON.stringify({ outcome: 'NOT_VERIFIED', reason: code, expected: 1000 }) + '\n'); process.exitCode = 2;
  }
}
main().catch(() => { process.stderr.write('SPP-82-C failed: check explicit inputs, new output path and isolated reader configuration.\n'); process.exitCode = 2; });
