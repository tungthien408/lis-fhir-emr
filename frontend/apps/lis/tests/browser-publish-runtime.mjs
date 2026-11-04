/** Read-only verification of the existing 5173 UI and 3101 LIS. Never clicks Publish. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'

const missing = process.argv.includes('--expect-route-missing')
const parent = path.resolve('tests/evidence/phase-2.3-runtime-404-2026-11-04')
mkdirSync(parent, { recursive: true })
const evidence = mkdtempSync(path.join(parent, missing ? 'before-' : 'after-'))
console.log('Evidence: ' + evidence)
const report = { source: 'Actual existing UI 5173 -> Vite proxy -> actual LIS 3101; GET only', expected: missing ? 'route missing' : 'unpublished FINAL', phases: [], completed: false }
const network = new Map(), violations = []
let browser
function onEvent(message) {
  const p = message.params
  if (message.method === 'Network.requestWillBeSent' && p.request.url.includes('/api/')) {
    network.set(p.requestId, { id: p.requestId, url: p.request.url, method: p.request.method })
    if (p.request.method !== 'GET') violations.push(p.request)
  }
  if (message.method === 'Network.responseReceived' && network.has(p.requestId)) Object.assign(network.get(p.requestId), { status: p.response.status })
}
async function loaded() {
  await until(async () => [...network.values()].some(r => r.url.endsWith('/MIMIC-LAB-100142/publish-event') && r.status) && await browser.evaluate(() => document.querySelector('[data-field="result_id"]')?.textContent === 'MIMIC-LAB-100142'
    && !!document.querySelector('[data-publish-panel]') && !document.querySelector('[data-publish-panel]').textContent.includes('Đang tra cứu')), 'real detail and publish lookup')
}
async function capture(label) {
  await loaded()
  const dom = await browser.evaluate(() => ({
    fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map(n => [n.dataset.field, n.textContent])),
    publish: Object.fromEntries([...document.querySelectorAll('[data-publish]')].map(n => [n.dataset.publish, n.textContent])),
    panel: document.querySelector('[data-publish-panel]').textContent,
    buttons: [...document.querySelectorAll('[data-publish-panel] button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })),
  }))
  assert.equal(dom.fields.result_status, 'FINAL'); assert.equal(Object.keys(dom.fields).length, 12)
  const button = dom.buttons.find(b => b.text === 'Publish')
  assert.ok(button); assert.equal(button.disabled, missing)
  assert.equal(dom.publish.published, missing ? 'Chưa xác minh' : 'Chưa Publish')
  assert.equal(dom.publish['exchange-status'], 'Chưa xác minh'); assert.ok(!dom.panel.includes('DELIVERED'))
  if (missing) assert.match(dom.panel, /HTTP 404/)
  else assert.ok(!dom.panel.includes('HTTP 404'))
  const http = []
  for (const entry of network.values()) {
    if (!entry.status) continue
    try { const r = await browser.command('Network.getResponseBody', { requestId: entry.id }); http.push({ ...entry, body: r.body }) } catch { http.push(entry) }
  }
  const lookup = http.findLast(r => r.url.endsWith('/MIMIC-LAB-100142/publish-event'))
  assert.equal(lookup?.status, missing ? 404 : 200)
  assert.ok(lookup?.body)
  const body = JSON.parse(lookup.body)
  if (missing) assert.equal(body.error.message, 'API route not found')
  else assert.deepEqual(body, { result_id: 'MIMIC-LAB-100142', result_status: 'FINAL', published: false, event: null })
  const { cssContentSize } = await browser.command('Page.getLayoutMetrics')
  const { data } = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } })
  writeFileSync(path.join(evidence, label + '.png'), Buffer.from(data, 'base64'))
  report.phases.push({ label, dom, http }); network.clear()
  console.log('PASS: ' + label)
}
try {
  browser = await openHttpBrowser(undefined, { publishRequests: true, onEvent })
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await browser.command('Page.navigate', { url: 'http://127.0.0.1:5173/#/results/MIMIC-LAB-100142' })
  await capture('initial')
  await browser.command('Page.reload'); await capture('f5')
  const before = browser.requests.length
  await browser.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Làm mới trạng thái').click())
  await until(() => browser.requests.length > before, 'refresh GET')
  await capture('refresh')
  assert.deepEqual(violations, []); assert.deepEqual(browser.exceptions, [])
  report.completed = true
} finally {
  if (browser) { report.requests = browser.requests; report.exceptions = browser.exceptions; await browser.close() }
  report.violations = violations
  writeFileSync(path.join(evidence, 'runtime-browser.json'), JSON.stringify(report, null, 2) + '\n')
}
