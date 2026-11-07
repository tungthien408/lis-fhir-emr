import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Mỗi lượt có thư mục riêng, kể cả khi bộ kiểm thử thất bại.
const root = path.resolve(import.meta.dirname, '..')
const parent = path.resolve(root, process.env.LIS_EVIDENCE_DIR || 'tests/evidence/phase-2.2-uiux-2026-11-04')
mkdirSync(parent, { recursive: true })
const evidence = mkdtempSync(path.join(parent, 'verification-'))
const suites = [
  ['uiux-real', ['tests/browser-uiux.mjs', '--real']],
  ['uiux-mock', ['tests/browser-uiux.mjs']],
  ['list-real', ['tests/browser.mjs']],
  ['list-http', ['--test', '--test-reporter=spec', 'tests/browser-http.mjs']],
  ['detail-real', ['tests/browser-detail.mjs', '--real']],
  ['detail-http', ['tests/browser-detail.mjs']],
  ['conditions-real', ['tests/browser-conditions.mjs', '--real']],
  ['conditions-http', ['tests/browser-conditions.mjs']],
  ['dot-preview-real', ['tests/browser-dot.mjs', '--real']],
  ['dot-preview-http', ['tests/browser-dot.mjs']],
  ['dot-dev-real', ['tests/browser-dot.mjs', '--dev', '--real']],
  ['dot-dev-http', ['tests/browser-dot.mjs', '--dev']],
]
const selected = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
if (selected) assert.ok(selected.every((name) => suites.some(([id]) => id === name)))
const report = { startedAt: new Date().toISOString(), evidence, suites: [], completed: false }
console.log('Bằng chứng: ' + evidence)
try {
  for (const [name, args] of suites) {
    if (selected && !selected.includes(name)) continue
    const folder = path.join(evidence, name)
    mkdirSync(folder)
    const entry = { name, args, startedAt: new Date().toISOString() }
    report.suites.push(entry)
    console.log('RUN: ' + name)
    let output = ''
    const child = spawn(process.execPath, args, {
      cwd: root, env: { ...process.env, LIS_EVIDENCE_DIR: folder },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk) })
    const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    writeFileSync(path.join(folder, 'console.log'), output)
    entry.exitCode = exitCode; entry.finishedAt = new Date().toISOString()
    assert.equal(exitCode, 0, name + ' thất bại; xem ' + folder)
  }
  report.completed = true
} finally {
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
}
