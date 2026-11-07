import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'

const real = process.argv.includes('--real'), mode = process.argv.includes('--dev') ? 'development' : 'preview'
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.3-2026-11-04/manual-' + Date.now()))
mkdirSync(evidence, { recursive: true })
const targets = { lis: process.env.LIS_TEST_TARGET, middleware: process.env.MIDDLEWARE_TEST_TARGET, emr: process.env.EMR_TEST_TARGET }
if (real) for (const value of Object.values(targets)) {
  assert.ok(value, 'Real mode requires disposable runner targets')
  const url = new URL(value); assert.equal(url.hostname, '127.0.0.1'); assert.ok(url.port && !['3101', '3102', '3103'].includes(url.port), 'Refuse team backend ports')
}
const report = { source: real ? 'Chrome + real APIs/Dispatcher/Worker/EMR on runner-owned synthetic tmpfs PostgreSQL' : 'Chrome + CDP HTTP simulation only', mode, startedAt: new Date().toISOString(), cases: [], completed: false }
const eventId = '00000000-0000-4000-8000-000000000001', exchangeId = '00000000-0000-4000-8000-000000000002'
const base = { result_id: 'R1', patient_id: 'PHASE23-P', test_code: 'PHASE23-TEST', test_name: 'Synthetic analyte', fluid: 'Blood', category: 'Chemistry',
  value_num: '3.6000', unit: 'mg/dL', reference_low: '3.3', reference_high: '5.1', effective_at: '2026-11-04T05:00:00.123456Z', result_status: 'FINAL' }
const records = new Map()
let browser, postMode, lookupFailure, middlewarePatch, detailStatus = 'FINAL'
function event(id, overrides = {}) { return { event_id: eventId, result_id: id, dispatch_status: 'PENDING', exchange_id: null, dispatch_attempt_count: 0,
  last_error_code: null, last_error_message: null, published_at: '2026-11-04T06:00:00.000Z', acked_at: null, next_retry_at: null, ...overrides } }
function simulated(req) {
  const url = new URL(req.url), pathname = url.pathname
  if (pathname.startsWith('/api/middleware/')) return { json: { exchange_id: exchangeId, event_id: eventId, source_system: 'lis-demo', source_result_id: 'R1',
    status: 'RECEIVED', retry_phase: null, verified_at: null, completed_at: null, ...middlewarePatch } }
  const match = /^\/api\/lis\/results\/([^/]+)(?:\/(publish|publish-event))?$/.exec(pathname)
  if (!match) return { json: { items: [{ ...base }], limit: Number(req.query.limit), offset: Number(req.query.offset) } }
  const id = decodeURIComponent(match[1]), action = match[2]
  const status = id === 'READY' ? 'READY' : detailStatus
  if (!action) return { json: { ...base, result_id: id, result_status: status } }
  if (action === 'publish-event') return lookupFailure ?? { json: { result_id: id, result_status: status, published: records.has(id), event: records.get(id) ?? null } }
  assert.equal(req.method, 'POST')
  if (postMode === 'network-lost') { records.set(id, event(id)); return { networkError: true } }
  if (postMode === 'badJSON') return { html: '<html>not JSON</html>' }
  if (postMode && /^\d+$/.test(postMode)) return { status: Number(postMode), json: { error: { code: postMode === '409' ? 'CONTENT_CONFLICT' : postMode === '422' ? 'RESULT_NOT_READY' : 'DEPENDENCY_UNAVAILABLE' } } }
  const old = records.get(id); const saved = old ?? event(id); records.set(id, saved)
  return { status: old ? 200 : 202, json: { event_id: saved.event_id, result_id: id, dispatch_status: saved.dispatch_status, exchange_id: saved.exchange_id } }
}
function observe() {
  window.publishHttp = []
  const original = window.fetch
  window.fetch = async (...args) => {
    const entry = { url: String(args[0]), method: args[1]?.method ?? 'GET', complete: false }; window.publishHttp.push(entry)
    try {
      const response = await original(...args); entry.status = response.status
      response.clone().text().then((text) => { try { entry.body = JSON.parse(text) } catch { entry.body = text }; entry.complete = true })
        .catch((error) => { entry.readError = String(error); entry.complete = true }) // request bị abort giữa chừng không phải lỗi của app
      return response
    } catch (error) { entry.error = String(error); entry.complete = true; throw error }
  }
}
const evaluate = (fn, arg) => browser.evaluate(fn, arg)
async function state() {
  return evaluate(() => ({ hash: location.hash,
    fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map((n) => [n.dataset.field, n.dataset.field === 'effective_at' ? n.querySelector('time')?.getAttribute('datetime') ?? null : n.textContent])),
    publish: Object.fromEntries([...document.querySelectorAll('[data-publish]')].map((n) => [n.dataset.publish, n.textContent])),
    buttons: [...document.querySelectorAll('[data-publish-panel] button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    dialog: !!document.querySelector('dialog')?.open, panel: document.querySelector('[data-publish-panel]')?.textContent,
    http: window.publishHttp, noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }))
}
async function loaded(id) {
  await until(async () => await evaluate((id) => document.querySelector('[data-field="result_id"]')?.textContent === id
    && !!document.querySelector('[data-publish-panel]') && !document.querySelector('[data-publish-panel]').textContent.includes('Đang tra cứu'), id), 'detail and lookup ' + id)
}
async function goto(id, context = '') { await browser.navigate('#/results/' + encodeURIComponent(id) + context); await loaded(id) }
async function click(text) { await evaluate((text) => {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
  if (!b || b.disabled) throw new Error('Unavailable button: ' + text); b.click()
}, text) }
async function openConfirm() {
  const s = await state(); await click(s.publish['event-id'] && s.publish['event-id'] !== '—' ? 'Publish lại' : 'Publish')
  await until(async () => (await state()).dialog, 'confirmation dialog')
}
async function submit() { await click('Xác nhận Publish'); await until(async () => !(await state()).panel.includes('Đang lưu yêu cầu') && !(await state()).panel.includes('Đang tra cứu'), 'POST and reconciliation') }
async function refresh() { await click('Làm mới trạng thái'); await delay(50); await until(async () => !(await state()).panel.includes('Đang tra cứu'), 'refresh') }
const posts = () => browser.requests.filter((r) => r.method === 'POST')
async function screenshot(name) {
  const { cssContentSize } = await browser.command('Page.getLayoutMetrics')
  const { data } = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } })
  writeFileSync(path.join(evidence, name + '.png'), Buffer.from(data, 'base64'))
}
async function check(name, action) {
  const item = { name, requestStart: browser.requests.length }; report.cases.push(item)
  try { await action(); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.interceptionErrors, []); item.result = 'PASS'; console.log('PASS: ' + name) }
  catch (error) { item.result = 'FAIL'; item.error = String(error.stack ?? error); await screenshot('FAIL-' + report.cases.length); throw error }
  finally { item.dom = await state(); item.requestEnd = browser.requests.length }
}
async function api(origin, suffix, options) {
  const r = await fetch(origin + suffix, { ...options, signal: AbortSignal.timeout(10000) }); const body = await r.json()
  ;(report.directApi ??= []).push({ origin, suffix, method: options?.method ?? 'GET', status: r.status, body })
  return { status: r.status, body }
}
try {
  browser = await openHttpBrowser(real ? undefined : simulated, { mode, lisTarget: real ? targets.lis : undefined,
    middlewareTarget: real ? targets.middleware : undefined, publishRequests: true })
  report.browser = browser.version; report.executable = browser.executable
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: '(' + observe.toString() + ')()' })
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  const finalId = real ? 'PHASE23-FINAL' : 'R1', readyId = real ? 'PHASE23-READY' : 'READY'
  await check('READY: disabled; no POST from UI', async () => {
    await goto(readyId)
    assert.equal((await state()).buttons.find((b) => b.text === 'Publish').disabled, true)
    assert.equal(posts().length, 0); await screenshot('publish-ready-desktop')
    if (real) { const response = await api(targets.lis, '/api/results/' + readyId + '/publish', { method: 'POST' }); assert.equal(response.status, 422); assert.equal(response.body.error.code, 'RESULT_NOT_READY') }
  })
  await check('FINAL: 12 fields preserved; cancel confirmation never POSTs', async () => {
    await goto(finalId, '?patient_id=PHASE23-P&test_code=PHASE23-TEST&result_status=FINAL&page=2')
    assert.equal(Object.keys((await state()).fields).length, 12)
    await openConfirm(); await screenshot('publish-confirm-desktop')
    await click('Hủy'); assert.equal((await state()).dialog, false); assert.equal(posts().length, 0)
  })
  await check('First Publish, rapid repeated clicks -> one POST and server event; no invented DELIVERED', async () => {
    await openConfirm()
    await evaluate(() => { const b = [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Xác nhận Publish'); for (let i = 0; i < 8; i++) b.click() })
    await until(async () => (await state()).publish['event-id'] !== '—', 'event saved')
    await until(async () => !(await state()).panel.includes('Đang tra cứu') && !(await state()).panel.includes('Đang lưu yêu cầu'), 'POST settled')
    assert.equal(posts().length, 1)
    const s = await state(); assert.equal(s.http.find((r) => r.method === 'POST').status, 202)
    if (!real) { assert.equal(s.publish['dispatch-status'], 'PENDING'); assert.equal(s.publish['exchange-status'], 'Chưa xác minh'); assert.ok(!s.panel.includes('đã được lưu và kiểm tra tại EMR')) }
    await screenshot('publish-first-desktop')
  })
  if (real) await check('Real Dispatcher/Worker -> DELIVERED; independently read EMR and expected patient/value', async () => {
    await until(async () => (await state()).publish['exchange-status'] === 'DELIVERED', 'real delivery')
    const fixture = JSON.parse(readFileSync(path.join(evidence, '../browser-fixture.json'), 'utf8'))
    const params = new URLSearchParams({ external_system: 'https://example.org/lis/result', external_id: finalId })
    const actual = await api(targets.emr, '/api/lab-results?' + params)
    assert.equal(actual.status, 200); assert.equal(actual.body.items.length, 1)
    assert.equal(actual.body.items[0].patient_key, fixture.patientKey); assert.equal(Number(actual.body.items[0].quantity), 3.6)
    assert.equal(actual.body.items[0].unit_text, 'mg/dL'); await screenshot('publish-delivered-desktop')
  })
  await check('Repeat Publish returns 200, same event and no reset', async () => {
    const id = (await state()).publish['event-id']; await openConfirm(); await submit()
    const s = await state(); assert.equal(s.publish['event-id'], id)
    assert.equal(s.http.filter((r) => r.method === 'POST').at(-1).status, 200)
    assert.match(s.panel, /không tạo mới/); await screenshot('publish-duplicate')
  })
  await check('F5/direct URL restores event by GET, Back/Forward preserves four filters/page', async () => {
    const id = (await state()).publish['event-id'], before = posts().length
    await browser.command('Page.reload'); await loaded(finalId); assert.equal((await state()).publish['event-id'], id)
    assert.equal(posts().length, before)
    await click('Quay lại danh sách'); await until(async () => await evaluate(() => document.querySelector('.results-pagination p')?.textContent === 'Trang 2'), 'list context page 2')
    assert.equal(await evaluate(() => document.getElementById('patient-id').value), 'PHASE23-P')
    await evaluate(() => history.back()); await loaded(finalId); assert.equal((await state()).publish['event-id'], id)
    await evaluate(() => history.forward()); await until(async () => await evaluate(() => !!document.querySelector('.results-content')), 'forward list')
    await goto(finalId); assert.equal((await state()).publish['event-id'], id); assert.equal(posts().length, before)
  })
  if (real) {
    await check('Changed source: HTTP409 CONTENT_CONFLICT; original event retained', async () => {
      await goto('PHASE23-CONFLICT'); const id = (await state()).publish['event-id']; await openConfirm(); await submit()
      const s = await state(); assert.match(s.panel, /Nội dung nguồn đã thay đổi/); assert.equal(s.publish['event-id'], id)
      assert.equal(s.http.filter((r) => r.method === 'POST').at(-1).status, 409); await screenshot('publish-content-conflict')
    })
    for (const id of ['.', '..', '%2E', '%2E%2E', '/', '%', '+', 'Kết quả/🧪?#']) await check('Real special ID Publish + lookup + F5: ' + id, async () => {
      await goto(id); await openConfirm(); await submit(); const saved = (await state()).publish['event-id']; assert.notEqual(saved, '—')
      await browser.command('Page.reload'); await loaded(id); assert.equal((await state()).publish['event-id'], saved)
    })
  } else {
    await check('ACK != DELIVERED; each middleware stage and mismatched/missing verification stays unconfirmed', async () => {
      await goto('R1')
      records.set('R1', event('R1', { dispatch_status: 'ACK', exchange_id: exchangeId, acked_at: '2026-11-04T06:00:01.000Z', dispatch_attempt_count: 1 }))
      for (const status of ['RECEIVED', 'PROCESSING', 'VERIFYING', 'RETRY_WAIT']) {
        middlewarePatch = { status, retry_phase: status === 'RETRY_WAIT' ? 'VERIFY' : null }; await refresh()
        assert.equal((await state()).publish['exchange-status'], status); assert.ok(!(await state()).panel.includes('đã được lưu và kiểm tra tại EMR'))
      }
      for (const patch of [{ event_id: 'WRONG' }, { source_result_id: 'OTHER' }, { verified_at: null }]) {
        middlewarePatch = { status: 'DELIVERED', verified_at: '2026-11-04T06:01:00.000Z', completed_at: '2026-11-04T06:01:00.000Z', ...patch }; await refresh()
        assert.equal((await state()).publish['exchange-status'], 'Chưa xác minh')
      }
      middlewarePatch = { status: 'DELIVERED', verified_at: '2026-11-04T06:01:00.000Z', completed_at: '2026-11-04T06:01:00.000Z' }; await refresh()
      assert.equal((await state()).publish['exchange-status'], 'DELIVERED'); await screenshot('publish-delivered-mock')
    })
    for (const code of ['400', '404', '409', '422', '503', 'badJSON']) await check('Publish error ' + code + ': no fake success/no automatic POST retry', async () => {
      postMode = code; await goto('ERR-' + code); const before = posts().length; await openConfirm(); await submit()
      const s = await state(); assert.equal(posts().length, before + 1); assert.notEqual(s.publish['exchange-status'], 'DELIVERED')
      assert.ok(s.panel.includes(code === '409' ? 'Nội dung nguồn' : code === '422' ? 'chưa FINAL' : code === 'badJSON' ? 'JSON' : 'HTTP ' + code))
      await delay(150); assert.equal(posts().length, before + 1)
      if (code === '409') await screenshot('publish-conflict-mock')
    })
    await check('Lost POST response reconciles by GET; no repeated POST; F5 restores saved event', async () => {
      postMode = 'network-lost'; await goto('LOST'); const before = posts().length; await openConfirm(); await submit()
      assert.equal(posts().length, before + 1); assert.notEqual((await state()).publish['event-id'], '—')
      assert.match((await state()).panel, /Chưa xác định/)
      await browser.command('Page.reload'); await loaded('LOST'); assert.equal(posts().length, before + 1); assert.notEqual((await state()).publish['event-id'], '—')
      postMode = undefined
    })
    await check('Lookup failure is unknown, not unpublished; no POST and recover GET only', async () => {
      lookupFailure = { status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE' } } }; const before = posts().length
      await goto('LOOKUP-FAIL'); assert.equal((await state()).publish.published, 'Chưa xác minh')
      assert.equal((await state()).buttons.find((b) => b.text === 'Publish').disabled, true)
      lookupFailure = undefined; await refresh(); assert.equal(posts().length, before)
    })
    await check('Lookup missing route/result/HTML and network outage stay unknown with Publish disabled', async () => {
      let scenario = 0
      for (const [response, expected] of [
        [{ status: 404, json: { error: { code: 'NOT_FOUND', message: 'API route not found' } } }, 'chưa hỗ trợ đường dẫn API'],
        [{ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Laboratory result not found' } } }, 'Không tìm thấy kết quả xét nghiệm'],
        [{ status: 404, html: '<html>Not found</html>' }, 'HTTP 404'],
        [{ networkError: true }, 'Không thể kết nối'],
      ]) {
        lookupFailure = response; const before = posts().length
        await goto('LOOKUP-ERROR-' + scenario++)
        const s = await state(); assert.equal(s.publish.published, 'Chưa xác minh')
        assert.equal(s.buttons.find(b => b.text === 'Publish').disabled, true)
        assert.ok(s.panel.includes(expected), JSON.stringify({ expected, panel: s.panel })); assert.notEqual(s.publish['exchange-status'], 'DELIVERED')
        assert.equal(posts().length, before)
      }
      lookupFailure = undefined; await refresh()
      assert.equal((await state()).publish.published, 'Chưa Publish')
      assert.equal((await state()).buttons.find(b => b.text === 'Publish').disabled, false)
    })
    await check('Source changes to READY while viewing, UI refreshes and disables Publish', async () => {
      detailStatus = 'FINAL'; await goto('SOURCE-CHANGE'); detailStatus = 'READY'; await refresh()
      await until(async () => (await state()).fields.result_status === 'READY', 'source refreshed')
      assert.equal((await state()).buttons.find((b) => b.text === 'Publish').disabled, true); detailStatus = 'FINAL'
    })
    await check('Late lookup and aborted request for A cannot overwrite B', async () => {
      await evaluate(() => {
        window.beforeHold = window.fetch
        window.fetch = async (url, options) => {
          const response = await window.beforeHold(url, { ...options, signal: undefined })
          if (String(url).includes('/LATE-A/publish-event')) { window.heldSignal = options.signal; await new Promise((resolve) => { window.releaseLookup = resolve }) }
          return response
        }
        location.hash = '#/results/LATE-A'
      })
      await until(async () => await evaluate(() => !!window.releaseLookup), 'held lookup')
      await evaluate(() => { location.hash = '#/results/LATE-B' }); await loaded('LATE-B')
      assert.equal(await evaluate(() => window.heldSignal.aborted), true)
      await evaluate(() => window.releaseLookup()); await delay(150); assert.equal((await state()).fields.result_id, 'LATE-B')
      await evaluate(() => { window.fetch = window.beforeHold })
    })
  }
  await check('Desktop/mobile: original 12 fields, Publish facts and dialog readable without overflow', async () => {
    await goto(finalId); await screenshot('publish-final-desktop')
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    assert.equal((await state()).noOverflow, true); assert.equal(Object.keys((await state()).fields).length, 12)
    await screenshot('publish-final-mobile'); await openConfirm(); assert.equal((await state()).noOverflow, true); await screenshot('publish-confirm-mobile'); await click('Hủy')
  })
  report.completed = true
} finally {
  if (browser) { report.requests = browser.requests; report.exceptions = browser.exceptions; report.interceptionErrors = browser.interceptionErrors; await browser.close() }
  report.finishedAt = new Date().toISOString(); writeFileSync(path.join(evidence, 'browser-publish.json'), JSON.stringify(report, null, 2) + '\n')
}
