import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// Chỉ đọc Git và nội dung file; không stage/commit. Kể cả file untracked cũng được thống kê.
const root = path.resolve(import.meta.dirname, '../../../..')
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.1-2026-11-03'))
const output = path.join(evidence, 'git-state.json')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
const list = (...args) => git(...args).split('\n').filter(Boolean)
const digest = (data) => createHash('sha256').update(data).digest('hex')
const read = (file) => readFileSync(path.resolve(root, file))
const baseline = JSON.parse(readFileSync(path.join(evidence, 'baseline.json'), 'utf8').replace(/^\uFEFF/, ''))
const require = createRequire(import.meta.url)
const allowed = (file) => file.startsWith('frontend/apps/lis/tests/') || file === 'frontend/apps/lis/README.md'
const modified = baseline.frontend_manifest.filter((entry) => !existsSync(path.resolve(root, entry.path)) || digest(read(entry.path)) !== entry.sha256)
const allFiles = [...new Set([...list('ls-files', '--', 'frontend'), ...list('ls-files', '--others', '--exclude-standard')])]
const original = new Set(baseline.frontend_manifest.map((entry) => entry.path))
const created = allFiles.filter((file) => !original.has(file))
assert.equal(git('branch', '--show-current'), 'feature/frontend/lis-emr-ui')
assert.equal(git('rev-parse', 'HEAD'), baseline.head)
assert.ok(modified.every((entry) => allowed(entry.path)), 'Có thay đổi ngoài kiểm thử/tài liệu LIS')
assert.ok(created.every(allowed), 'Có file mới ngoài kiểm thử/tài liệu LIS')
assert.deepEqual(list('diff', '--name-only').filter((file) => !file.startsWith('frontend/')), [], 'Có thay đổi tracked ngoài frontend')
assert.equal(git('diff', '--cached', '--name-only'), '', 'Index phải giữ nguyên, không stage')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}
const buildFiles = walk(path.join(root, 'frontend/apps/lis/dist')).map((file) => ({
  path: path.relative(root, file).replaceAll('\\', '/'), sha256: digest(readFileSync(file)),
}))
if (!existsSync(output)) writeFileSync(output, '{}\n')
const untracked = list('ls-files', '--others', '--exclude-standard')
const tracked = list('diff', '--numstat').map((line) => {
  const [added, deleted, file] = line.split('\t')
  return { path: file, added: Number(added), deleted: Number(deleted) }
})
const snapshot = {
  capturedAt: new Date().toISOString(), timezone: 'Asia/Bangkok',
  head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  note: 'HEAD cộng working tree, không phải chỉ HEAD. SHA-256 file nguồn đối chiếu baseline. Không tự băm git-state.json để tránh vòng lặp; vẫn tính đủ file/byte/dòng của chính nó.',
  versions: { node: process.version, react: require('react/package.json').version, reactDom: require('react-dom/package.json').version, vite: require('vite/package.json').version, typescript: require('typescript/package.json').version },
  baselineStatus: baseline.status, finalStatus: list('status', '--short', '--untracked-files=all'),
  modifiedSinceBaseline: modified.map((entry) => ({ path: entry.path, before: entry.sha256, after: digest(read(entry.path)) })),
  createdSinceBaseline: [...new Set([...created, path.relative(root, output).replaceAll('\\', '/')])].sort(),
  unchangedBaselineFiles: baseline.frontend_manifest.length - modified.length,
  functionalSourceUnchanged: true, allowedScopeOnly: true, stagedFiles: [],
  testedFrontendFiles: baseline.frontend_manifest.filter((entry) => !allowed(entry.path)).map((entry) => ({ path: entry.path, sha256: digest(read(entry.path)) })),
  testFiles: allFiles.filter((file) => file.startsWith('frontend/apps/lis/tests/') && file.endsWith('.mjs')).map((file) => ({ path: file, sha256: digest(read(file)) })),
  buildFiles, tracked,
  trackedTotals: { files: tracked.length, added: tracked.reduce((sum, f) => sum + f.added, 0), deleted: tracked.reduce((sum, f) => sum + f.deleted, 0) },
}

let stable = false
for (let attempt = 0; attempt < 10; attempt++) {
  snapshot.untracked = untracked.map((file) => {
    const data = read(file), binary = data.includes(0), self = path.resolve(root, file) === output
    return { path: file, bytes: data.length, binary, lines: binary ? null : data.toString('utf8').split('\n').length - (data.at(-1) === 10 ? 1 : 0), sha256: self ? null : digest(data) }
  })
  snapshot.untrackedTotals = {
    files: snapshot.untracked.length,
    textFiles: snapshot.untracked.filter((f) => !f.binary).length,
    binaryFiles: snapshot.untracked.filter((f) => f.binary).length,
    bytes: snapshot.untracked.reduce((sum, f) => sum + f.bytes, 0),
    lines: snapshot.untracked.reduce((sum, f) => sum + (f.lines ?? 0), 0),
  }
  const previous = readFileSync(output, 'utf8')
  const next = JSON.stringify(snapshot, null, 2) + '\n'
  writeFileSync(output, next)
  if (previous === next) { stable = true; break }
}
assert.ok(stable, 'Thống kê tự thân chưa ổn định')
console.log(JSON.stringify({ tracked: snapshot.trackedTotals, untracked: snapshot.untrackedTotals, modifiedSinceBaseline: modified.map((f) => f.path), created: snapshot.createdSinceBaseline.length, unchangedBaselineFiles: snapshot.unchangedBaselineFiles, scope: 'PASS' }, null, 2))
