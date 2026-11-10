import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'
import { fixture, id } from './flow-fixtures.mjs'

const live = process.argv.includes('--real')
const mode = process.argv.includes('--dev') ? 'development' : 'preview'
const app = process.argv.find(a => a.startsWith('--app='))?.slice(6) ?? 'lis'
const suffix = app === 'lis' ? '' : '-' + app
const dir = path.join(import.meta.dirname, 'evidence/stitch-redesign')
mkdirSync(dir, { recursive: true })
let data = await fixture('READY'), posts = 0, fault = false, pendingPublish
const simulated = async req => {
  const url = new URL(req.url), p = url.pathname
  if (req.method === 'POST') {
    assert.ok(p.endsWith('/publish')); posts++
    if (pendingPublish) await pendingPublish
    data = await fixture('PROCESSING')
    return { status: 202, json: data.publish.event }
  }
  if (p.endsWith('/publish-event')) return fault ? { status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE' } } } : { json: data.publish }
  if (p === '/api/lis/results') return { json: { items: Array.from({ length: 5 }, (_, i) => ({ ...data.source, result_id: i ? 'STITCH-TEST-' + (i + 1) : id })), limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) } }
  if (p.startsWith('/api/lis/results/')) return { json: data.source }
  if (p.endsWith('/attempts')) return { json: data.attempts }
  if (p.startsWith('/api/middleware/exchanges/')) return { json: data.detail }
  if (p === '/api/emr/lab-results') return { json: { items: [data.emr.result] } }
  if (p === '/api/emr/patients') return { json: { patient: data.emr.patient } }
  throw new Error('Unexpected request ' + req.url)
}
const browser = await openHttpBrowser(live ? null : simulated, { mode, app, reuseServer: process.argv.includes('--reuse-server'), publishRequests: true, flowRequests: true })
const cases = []
async function waitStatus(status) { await until(() => browser.evaluate(s => document.querySelector('[data-flow-status]')?.getAttribute('data-flow-status') === s, status), status) }
async function screenshot(name) {
  await browser.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); window.scrollTo(0, 0) })
  const { cssContentSize } = await browser.command('Page.getLayoutMetrics')
  const shot = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } })
  writeFileSync(path.join(dir, `${live ? 'real' : 'mock'}-${mode}${suffix}-${name}.png`), Buffer.from(shot.data, 'base64'))
}
try {
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1100, deviceScaleFactor: 1, mobile: false })
  if (live) {
    // All requests in the live suite are GET: reuse existing records only.
    const transactions = await (await fetch('http://127.0.0.1:3102/api/exchanges?status=DELIVERED&limit=10&offset=0')).json()
    assert.ok(transactions.items.length, 'Need an existing DELIVERED exchange')
    const selected = transactions.items[0].source_result_id
    await browser.navigate('#/flow?result_id=' + encodeURIComponent(selected))
    await waitStatus('DELIVERED')
    await until(() => browser.evaluate(() => document.querySelector('.emr-result') !== null), 'Actual EMR readback')
    assert.equal(await browser.evaluate(() => document.querySelectorAll('.comparison-table [aria-label="Khớp"]').length), 9)
    cases.push('Existing DELIVERED: LIS publish lookup → exchange/attempts → EMR result/patient → 9 visible comparisons (10 model checks)')
    await screenshot('delivered')
    const results = await (await fetch('http://127.0.0.1:3101/api/results?result_status=FINAL&limit=20&offset=0')).json()
    let ready
    for (const result of results.items) {
      const state = await (await fetch('http://127.0.0.1:3101/api/results/' + encodeURIComponent(result.result_id) + '/publish-event')).json()
      if (!state.published) { ready = result; break }
    }
    assert.ok(ready, 'Need an existing unpublished FINAL result')
    await browser.navigate('#/flow?result_id=' + encodeURIComponent(ready.result_id)); await waitStatus('SẴN SÀNG'); await screenshot('ready')
    cases.push('Actual unpublished FINAL: ready, no fabricated stages')
    assert.ok(browser.requests.every(r => r.method === 'GET'))
  } else {
    await browser.navigate('#/flow?result_id=' + id); await waitStatus('SẴN SÀNG'); await screenshot('ready')
    assert.equal(await browser.evaluate(() => document.querySelector('.stitch-nav')), null)
    const beforeIcon = browser.requests.length
    assert.deepEqual(await browser.evaluate(() => {
      const icon = document.querySelector('.stitch-brand .icon-box'), box = icon.getBoundingClientRect(), hash = location.hash
      icon.click()
      return { decorative: icon.getAttribute('aria-hidden'), interactive: icon.matches('button,a,[tabindex]'), width: box.width, height: box.height, changed: location.hash !== hash, dialog: !!document.querySelector('dialog') }
    }), { decorative: 'true', interactive: false, width: 44, height: 44, changed: false, dialog: false })
    assert.equal(browser.requests.length, beforeIcon)
    assert.deepEqual(await browser.evaluate(() => [...document.querySelectorAll('[data-stage]')].map(e => e.dataset.tone)), ['idle', 'idle', 'idle', 'idle', 'idle'])
    cases.push('Ready from unpublished API, five idle stations')
    let release
    pendingPublish = new Promise(resolve => { release = resolve })
    await browser.evaluate(() => { const button = document.querySelector('.dispatch-button'); button.click(); button.click() })
    await until(() => posts === 1, 'Single POST despite repeated click')
    release(); pendingPublish = null
    await waitStatus('PROCESSING')
    assert.equal(posts, 1)
    assert.deepEqual(await browser.evaluate(() => [...document.querySelectorAll('[data-stage]')].map(e => e.dataset.tone)), ['done', 'done', 'active', 'idle', 'idle'])
    assert.equal(await browser.evaluate(() => document.querySelector('.dispatch-button').disabled), false)
    await screenshot('processing'); cases.push('Publish single-flight + real polling response; ACK does not deliver')
    data = await fixture()
    await waitStatus('DELIVERED')
    await until(() => browser.evaluate(() => !!document.querySelector('.emr-result')), 'EMR populated')
    assert.equal(await browser.evaluate(() => document.querySelectorAll('.comparison-table [aria-label="Khớp"]').length), 9)
    await screenshot('delivered'); cases.push('DELIVERED auto-poll, EMR readback and 9 visible comparisons (10 model checks)')
    await browser.evaluate(() => document.getElementById('tab-json').click())
    assert.ok(await browser.evaluate(() => document.querySelector('.payload-grid').textContent.includes('source') || document.querySelector('.payload-grid').textContent.includes('STITCH-TEST-1')))
    await browser.evaluate(() => { document.getElementById('tab-json').focus(); document.getElementById('tab-json').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    assert.equal(await browser.evaluate(() => document.activeElement.id), 'tab-log'); cases.push('JSON evidence and keyboard tab navigation')
    data = await fixture('REJECTED'); await browser.command('Page.reload'); await waitStatus('REJECTED')
    assert.equal(await browser.evaluate(() => document.querySelector('[data-stage="4"]').dataset.tone), 'error')
    assert.equal(await browser.evaluate(() => document.querySelector('[data-stage="5"]').dataset.tone), 'idle')
    assert.ok(await browser.evaluate(() => document.body.textContent.includes('REMOTE_VALIDATION_ERROR') && !document.body.textContent.includes('PATIENT_NOT_LINKED')))
    await screenshot('rejected'); cases.push('REJECTED shows actual sanitized code, SEND stage, no invented patient cause')
    fault = true; await browser.command('Page.reload')
    await until(() => browser.evaluate(() => !!document.querySelector('.pipeline-panel [role="alert"]')), 'API failure shown')
    assert.equal(await browser.evaluate(() => document.querySelector('.dispatch-button').disabled), true); cases.push('503 remains unknown and blocks Publish')
    fault = false; data = await fixture('READY')
    await browser.command('Page.reload'); await waitStatus('SẴN SÀNG')
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    assert.ok(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow on mobile')
    await screenshot('mobile'); cases.push('390px responsive layout, table scroll isolated')
    for (const hash of ['#/results', '#/results/MIMIC-LAB-1?result_status=FINAL', '#/exchanges', '#/exchanges/bad', '#/search?value=x', '#/patients/key', '#/result?external_id=x', '#/results/%ZZ']) {
      await browser.navigate(hash)
      await until(() => browser.evaluate(() => location.hash === '#/flow' && !!document.querySelector('.flow-console')), 'Redirect ' + hash)
      await waitStatus('SẴN SÀNG')
      assert.equal(await browser.evaluate(() => !!document.querySelector('.workspace, dialog, nav') || !!document.querySelector('[role="alert"]')), false)
    }
    for (const pathname of ['/results/R1', '/exchanges/123?status=FAILED', '/patients/123', '/search', '/result?external_id=1']) {
      await browser.navigatePath(pathname)
      await until(() => browser.evaluate(() => location.pathname === '/' && location.hash === '#/flow' && !!document.querySelector('.flow-console')), 'Redirect path ' + pathname)
      await waitStatus('SẴN SÀNG')
    }
    cases.push('Legacy hash/path URLs redirect to Flow Console; decorative icon has no action')
    await browser.navigate('#/flow?result_id=%ZZ')
    await until(() => browser.evaluate(() => document.body.textContent.includes('URL hoặc mã kết quả không hợp lệ')), 'Malformed route rejected')
    cases.push('Malformed encoded identity rejected')
  }
  assert.equal(await browser.evaluate(() => [...document.querySelectorAll('a[href]')].some(a => /#\/(results?|exchanges|patients|search)([/?]|$)/.test(a.getAttribute('href')))), false)
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.interceptionErrors, [])
  console.log(JSON.stringify({ app, origin: browser.origin, mode, live, cases, requestCount: browser.requests.length, posts, result: 'PASS' }, null, 2))
} finally {
  writeFileSync(path.join(dir, `${live ? 'real' : 'mock'}-${mode}${suffix}-report.json`), JSON.stringify({ app, origin: browser.origin, mode, live, cases, requests: browser.requests, exceptions: browser.exceptions, interceptionErrors: browser.interceptionErrors }, null, 2))
  await browser.close()
}
