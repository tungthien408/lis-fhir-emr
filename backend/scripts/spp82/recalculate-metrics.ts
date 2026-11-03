/** Offline only; never contacts services or changes original evidence. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateMetrics, replayJsonl } from './metrics.js';
import type { RunManifest } from './run-recorder.js';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node --import tsx scripts/spp82/recalculate-metrics.ts <artifact-directory>');
const manifest = JSON.parse(readFileSync(join(directory, 'run-manifest.json'), 'utf8')) as RunManifest;
const rows = replayJsonl(readFileSync(join(directory, 'per-result.jsonl'), 'utf8'));
process.stdout.write(JSON.stringify(calculateMetrics(manifest, rows), null, 2) + '\n');
