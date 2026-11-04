import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'
import { lisResultRequest, DOT_SEGMENT_HEADER } from '../src/api/resultRequest.ts'
import { resultsHash, parseResultsHash } from '../src/state/routes.ts'

const real = process.argv.includes('--real')
const mode = process.argv.includes('--dev') ? 'development' : 'preview'
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.2-dot-fix-2026-11-03', mode + (real ? '-real' : '-mock')))
mkdirSync(evidence, { recursive: true })
const ids = ['.', '..', '%2E', '%2E%2E', '%2e', '%2e%2e', '%252E', '%', '%25', 'R1', 'a/b', 'a%2Fb', '+', '#', '?', ' Kết quả/AbC+%?# 🧪 ']
const fixtures = ids.map((id, i) => ({
  result_id: id, patient_id: 'DOT-P1', test_code: 'DOT-T1', test_name: 'HTTP mô phỏng ' + i,
  fluid: 'Blood', category: null, value_num: i === 0 ? '0' : i === 1 ? '-2.50' : String(i) + '.000000000123456789',
  unit: 'mg/dL', reference_low: i % 2 ? '-10.0000' : null, reference_high: i % 2 ? null : '10.0000',
  effective_at: '2180-06-03T12:34:56.123456Z', result_status: 'FINAL',
}))
const query = { filters: { patientId: real ? 'MIMIC-P-10007928' : 'DOT-P1', testCode: real ? '50912' : 'DOT-T1', resultStatus: 'FINAL' }, pageIndex: 0 }
const report = {
  source: real ? 'Chrome + proxy LIS cấu hình thật + backend thật, chỉ GET; dot record có thể404, không tạo dữ liệu'
    : 'Chrome + proxy LIS cấu hình thật + HTTP upstream mô phỏng (không CDP fulfill), không database',
  mode, startedAt: new Date().toISOString(), completed: false, checks: [], upstream: [], protocol: [], directBackend: [],
}
let browser, upstream, failId, heldId, releaseUpstream
const heldResponses = []
const requestMap = new Set()
const onEvent = (event) => {
  if (event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('/api/') && !event.params.request.url.includes('/publish-event')) {
    requestMap.add(event.params.requestId)
    report.protocol.push({ event: event.method, requestId: event.params.requestId, request: event.params.request })
  }
  if (['Network.responseReceived', 'Network.loadingFailed'].includes(event.method) && requestMap.has(event.params.requestId)) {
    report.protocol.push({ event: event.method, ...event.params })
  }
}
async function direct(id) {
  const rawPath = '/api/results/' + (id === '.' || id === '..' ? id.replaceAll('.', '%2E') : encodeURIComponent(id))
  const data = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: 3101, path: rawPath, timeout: 10000 }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (part) => { text += part })
      response.on('end', () => resolve({ method: 'GET', rawPath, status: response.statusCode, body: JSON.parse(text) }))
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('timeout')))
  })
  assert.ok([200, 404].includes(data.status))
  report.directBackend.push(data)
  return data
}
function observe() {
  const original = window.fetch
  window.dotDocument = crypto.randomUUID()
  window.dotHttp = []
  window.fetch = async function (url, options) {
    if (String(url).includes('/publish-event')) return original.call(this, url, options)
    const entry = { url: new URL(url, location.href).href, headers: options?.headers ?? {}, signal: options?.signal, complete: false }
    window.dotHttp.push(entry)
    try {
      const response = await original.call(this, url, options)
      entry.status = response.status
      entry.vary = response.headers.get('vary')
      response.clone().json().then((body) => { entry.body = body; entry.complete = true })
        .catch((error) => { entry.readError = String(error); entry.complete = true })
      return response
    } catch (error) { entry.error = String(error); entry.complete = true; throw error }
  }
}
const evaluate = (fn, value) => browser.evaluate(fn, value)
async function state() {
  return evaluate(() => ({
    hash: location.hash, document: window.dotDocument,
    busy: document.querySelector('.detail-content')?.getAttribute('aria-busy'),
    listBusy: document.querySelector('.results-content')?.getAttribute('aria-busy'),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map((node) => [node.dataset.field,
      node.dataset.field === 'effective_at' ? node.querySelector('time')?.getAttribute('datetime') ?? null : node.textContent])),
    timeText: document.querySelector('.detail-content time')?.textContent,
    timeTitle: document.querySelector('.detail-content time')?.title,
    inputs: ['patient-id', 'test-code', 'result-status'].map((id) => document.getElementById(id)?.value ?? null),
    ids: [...document.querySelectorAll('tbody tr')].map((r) => r.cells[0].textContent),
    http: (window.dotHttp ?? []).map(({ signal, ...r }) => ({ ...r, aborted: signal?.aborted })),
  }))
}
async function check(name, action) {
  const entry = { name, requestStart: browser.requests.length, upstreamStart: report.upstream.length }
  report.checks.push(entry)
  try {
    await action(entry)
    assert.deepEqual(browser.exceptions, [])
    assert.deepEqual(browser.interceptionErrors, [])
    entry.result = 'PASS'
    entry.state = await state()
    console.log('PASS: ' + name)
  } catch (error) { entry.result = 'FAIL'; entry.error = String(error.stack ?? error); throw error }
  finally { entry.requestEnd = browser.requests.length; entry.upstreamEnd = report.upstream.length }
}
async function settle(action, predicate, reload = false) {
  const before = await state(), start = browser.requests.length
  await action()
  await until(async () => {
    const current = await state()
    return browser.requests.length > start && current.http.at(-1)?.complete
      && (!reload || current.document !== before.document) && predicate(current)
  }, 'request mới và trạng thái đúng')
  return state()
}
function expectedFields(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'effective_at' ? value : value ?? '—']))
}
function assertDetail(current, row, hash) {
  assert.equal(current.hash, hash)
  assert.equal(current.busy, 'false')
  assert.equal(current.alert, null)
  assert.deepEqual(current.fields, expectedFields(row))
  const request = lisResultRequest(row.result_id), last = current.http.at(-1)
  assert.equal(new URL(last.url).pathname, request.path)
  assert.equal(new URL(last.url).search, '')
  assert.deepEqual(last.headers, request.headers ?? {})
  assert.equal(last.status, 200)
  assert.deepEqual(last.body, row)
  assert.equal(current.timeText, row.effective_at?.slice(0, 19).replace('T', ' ') ?? undefined)
  assert.equal(current.timeTitle, row.effective_at ?? undefined)
}
async function click(text, id) {
  await evaluate(({ text, id }) => {
    const scope = id === undefined ? document : [...document.querySelectorAll('tbody tr')].find((r) => r.cells[0].textContent === id)
    const button = scope && [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('Nút không khả dụng: ' + text + ' / ' + id)
    button.click()
  }, { text, id })
}
async function open(row, hash = resultsHash(query, row.result_id)) {
  const current = await settle(() => browser.navigate(hash), (s) => s.fields.result_id === row.result_id && s.busy === 'false')
  assertDetail(current, row, hash)
}
async function list(action) {
  const hash = resultsHash(query)
  const current = await settle(action, (s) => s.listBusy === 'false' && s.hash === hash && s.ids.length > 0)
  assert.equal(current.hash, hash)
  assert.deepEqual(current.inputs, Object.values(query.filters))
  const params = Object.fromEntries(new URL(current.http.at(-1).url).searchParams)
  assert.deepEqual(params, { limit: '11', offset: '0', patient_id: query.filters.patientId, test_code: query.filters.testCode, result_status: 'FINAL' })
  return current
}
try {
  if (!real) {
    upstream = http.createServer(async (req, res) => {
      const rawPath = req.url.split('?')[0]
      const id = rawPath.startsWith('/api/results/') ? decodeURIComponent(rawPath.slice('/api/results/'.length)) : null
      if (rawPath.endsWith('/publish-event')) {
        const resultId = decodeURIComponent(rawPath.slice('/api/results/'.length, -'/publish-event'.length))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ result_id: resultId, result_status: 'FINAL', published: false, event: null }))
        return
      }
      const entry = { rawPath: req.url, id, marker: req.headers[DOT_SEGMENT_HEADER.toLowerCase()] ?? null, method: req.method }
      report.upstream.push(entry)
      assert.equal(req.method, 'GET')
      assert.equal(entry.marker, null)
      res.on('close', () => { if (!res.writableEnded) entry.canceled = true })
      if (heldId !== undefined && id === heldId) {
        await new Promise((resolve) => {
          heldResponses.push(resolve)
          releaseUpstream = () => { heldId = undefined; for (const release of heldResponses.splice(0)) release() }
        })
        if (res.destroyed) return
      }
      let status = 200, body
      if (failId !== undefined && id === failId) { status = 503; body = { error: { code: 'DEPENDENCY_UNAVAILABLE' } } }
      else if (id !== null) {
        body = fixtures.find((row) => row.result_id === id)
        if (!body) { status = 404; body = { error: { code: 'NOT_FOUND' } } }
      } else if (rawPath === '/api/results') {
        const params = new URLSearchParams(req.url.split('?')[1])
        const matches = fixtures.filter((r) => ['patient_id', 'test_code', 'result_status'].every((k) => !params.has(k) || params.get(k) === r[k]))
        const limit = Number(params.get('limit')), offset = Number(params.get('offset'))
        body = { items: matches.slice(offset, offset + limit), limit, offset }
      } else { status = 404; body = { error: { code: 'NOT_FOUND' } } }
      entry.status = status
      entry.body = body
      res.writeHead(status, { 'Content-Type': 'application/json', Vary: 'Accept-Encoding', 'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store' })
      res.end(JSON.stringify(body))
    })
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  }
  browser = await openHttpBrowser(undefined, { mode, lisTarget: upstream ? 'http://127.0.0.1:' + upstream.address().port : undefined, onEvent })
  report.browser = browser.version
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: '(' + observe.toString() + ')()' })
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  if (real) {
    for (const id of ['.', '..', '%2E', '%2E%2E']) await check('Backend thật: ID ' + id + ' qua hash → proxy → HTTP', async (entry) => {
      const expected = await direct(id)
      const hash = resultsHash(query, id)
      assert.equal(parseResultsHash(hash).resultId, id)
      const current = await settle(() => browser.navigate(hash), (s) => s.busy === 'false' && s.hash === hash)
      entry.realRecordFound = expected.status === 200
      assert.equal(current.http.at(-1).status, expected.status)
      assert.deepEqual(current.http.at(-1).body, expected.body)
      assert.equal(new URL(current.http.at(-1).url).pathname, lisResultRequest(id).path)
      assert.deepEqual(current.http.at(-1).headers, lisResultRequest(id).headers ?? {})
      if (expected.status === 200) assertDetail(current, expected.body, hash)
      else {
        assert.equal(expected.body.error.message, 'Laboratory result not found')
        assert.ok(current.alert.includes('HTTP 404') && current.alert.includes('Không tìm thấy'))
        assert.ok(!current.alert.includes('URL không hợp lệ'))
        await list(() => click('Quay lại danh sách'))
      }
    })
    const sample = await direct('MIMIC-LAB-100142')
    assert.equal(sample.status, 200)
    await check('Backend thật: bản ghi thường và đủ ba filter, F5/Quay lại/Back/Forward', async () => {
      if ((await state()).hash === resultsHash(query)) {
        await settle(() => browser.command('Page.reload'), (s) => s.listBusy === 'false' && s.hash === resultsHash(query), true)
        await listCheck()
      } else await list(() => browser.navigate(resultsHash(query)))
      await settle(() => click('Xem chi tiết', sample.body.result_id), (s) => s.fields.result_id === sample.body.result_id)
      assertDetail(await state(), sample.body, resultsHash(query, sample.body.result_id))
      await settle(() => browser.command('Page.reload'), (s) => s.fields.result_id === sample.body.result_id && s.busy === 'false', true)
      assertDetail(await state(), sample.body, resultsHash(query, sample.body.result_id))
      await list(() => click('Quay lại danh sách'))
      await settle(() => evaluate(() => history.back()), (s) => s.fields.result_id === sample.body.result_id)
      assertDetail(await state(), sample.body, resultsHash(query, sample.body.result_id))
      await list(() => evaluate(() => history.forward()))
    })
  } else {
    for (const row of fixtures) await check('Upstream mô phỏng qua proxy thật: ID ' + JSON.stringify(row.result_id), async (entry) => {
      await open(row)
      const last = report.upstream.at(-1), dot = row.result_id === '.' || row.result_id === '..'
      assert.equal(last.id, row.result_id)
      assert.equal(last.rawPath, '/api/results/' + (dot ? row.result_id.replaceAll('.', '%2E') : encodeURIComponent(row.result_id)))
      assert.equal(last.marker, null)
      entry.rawUpstream = last
    })
    for (const row of fixtures.slice(0, 2)) await check('Dot ID ' + row.result_id + ': từ bảng, F5 detail/list, Quay lại, Back/Forward, hash encoded', async () => {
      await list(() => browser.navigate(resultsHash(query)))
      await settle(() => click('Xem chi tiết', row.result_id), (s) => s.fields.result_id === row.result_id)
      assertDetail(await state(), row, resultsHash(query, row.result_id))
      await settle(() => browser.command('Page.reload'), (s) => s.fields.result_id === row.result_id && s.busy === 'false', true)
      assertDetail(await state(), row, resultsHash(query, row.result_id))
      writeFileSync(path.join(evidence, row.result_id === '.' ? 'dot-detail.png' : 'dotdot-detail.png'), Buffer.from(await browser.screenshot(), 'base64'))
      await list(() => click('Quay lại danh sách'))
      await settle(() => browser.command('Page.reload'), (s) => s.listBusy === 'false' && s.hash === resultsHash(query), true)
      await listCheck()
      await settle(() => evaluate(() => history.back()), (s) => s.fields.result_id === row.result_id)
      assertDetail(await state(), row, resultsHash(query, row.result_id))
      await list(() => evaluate(() => history.forward()))
      const encoded = resultsHash(query, row.result_id).replace('/' + row.result_id + '?', '/' + row.result_id.replaceAll('.', '%2E') + '?')
      await open(row, encoded)
    })
    await check('Cache thật Chrome: cùng wire URL, dot và literal %2E không trộn phản hồi', async (entry) => {
      await browser.command('Network.setCacheDisabled', { cacheDisabled: false })
      entry.results = await evaluate(async ({ requests, header }) => {
        const output = []
        for (let round = 0; round < 3; round++) for (const { id, path, headers } of requests) {
          const response = await fetch(path, { headers, cache: 'force-cache' })
          const body = await response.json()
          output.push({ id, responseId: body.result_id, value: body.value_num, vary: response.headers.get('vary'), header })
        }
        return output
      }, { requests: ['.', '.', '%2E', '%2E', '..', '..', '%2E%2E', '%2E%2E'].map((id) => ({ id, ...lisResultRequest(id) })), header: DOT_SEGMENT_HEADER })
      assert.equal(entry.results.length, 24)
      await until(() => report.protocol.some((e) => e.event === 'Network.responseReceived' && e.response.fromDiskCache), 'Chrome cache hit')
      entry.cacheHits = report.protocol.filter((e) => e.event === 'Network.responseReceived' && e.response.fromDiskCache).length
      for (const row of entry.results) {
        assert.equal(row.responseId, row.id)
        assert.equal(row.value, fixtures.find((f) => f.result_id === row.id).value_num)
        assert.ok(row.vary.toLowerCase().includes(DOT_SEGMENT_HEADER.toLowerCase()))
      }
      await browser.command('Network.setCacheDisabled', { cacheDisabled: true })
    })
    await check('Dot ID: HTTP503 → thử lại cùng . → HTTP200', async () => {
      await list(() => browser.navigate(resultsHash(query)))
      failId = '.'
      await settle(() => evaluate((h) => { location.hash = h }, resultsHash(query, '.')), (s) => s.alert?.includes('HTTP 503'))
      const before = report.upstream.length
      failId = undefined
      await settle(() => click('Thử tải lại'), (s) => s.fields.result_id === '.')
      assertDetail(await state(), fixtures[0], resultsHash(query, '.'))
      assert.equal(report.upstream.length, before + 1)
      assert.equal(report.upstream.at(-1).id, '.')
    })
    await check('Dot ID: native abort GET đang bay khi chuyển . → ..', async (entry) => {
      await list(() => browser.navigate(resultsHash(query)))
      heldId = '.'
      await evaluate((h) => { location.hash = h }, resultsHash(query, '.'))
      await until(() => typeof releaseUpstream === 'function', 'upstream giữ dot response')
      assert.equal((await state()).busy, 'true')
      const old = report.upstream.at(-1)
      const next = await settle(() => evaluate((h) => { location.hash = h }, resultsHash(query, '..')), (s) => s.fields.result_id === '..')
      assertDetail(next, fixtures[1], resultsHash(query, '..'))
      await until(() => old.canceled === true, 'upstream nhận hủy transport')
      const release = releaseUpstream; releaseUpstream = undefined; release()
      entry.oldRequestCanceled = old.canceled
    })
    await check('Dot ID: response . đến muộn không ghi đè .. kể cả khi bỏ qua abort mạng trong harness', async () => {
      await list(() => browser.navigate(resultsHash(query)))
      await evaluate(() => {
        window.dotSavedFetch = window.fetch
        window.fetch = async (url, options) => {
          const hold = options?.headers?.['X-LIS-Dot-Segment'] === '1' && String(url).endsWith('/%252E')
          if (!hold) return window.dotSavedFetch(url, options)
          window.dotOldSignal = options.signal
          const response = await window.dotSavedFetch(url, { ...options, signal: undefined })
          await new Promise((resolve) => { window.dotRelease = resolve })
          return response
        }
      })
      await evaluate((h) => { location.hash = h }, resultsHash(query, '.'))
      await until(async () => await evaluate(() => typeof window.dotRelease === 'function'), 'giữ response trước khi app nhận')
      await settle(() => evaluate((h) => { location.hash = h }, resultsHash(query, '..')), (s) => s.fields.result_id === '..')
      assert.equal(await evaluate(() => window.dotOldSignal.aborted), true)
      await evaluate(() => { window.dotRelease(); window.fetch = window.dotSavedFetch })
      await delay(200)
      assertDetail(await state(), fixtures[1], resultsHash(query, '..'))
    })
  }
  assert.ok(browser.requests.every((r) => r.method === 'GET'))
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.interceptionErrors, [])
  report.completed = true
} finally {
  if (releaseUpstream) releaseUpstream()
  if (browser) {
    report.requests = browser.requests; report.exceptions = browser.exceptions; report.interceptionErrors = browser.interceptionErrors
    await browser.close()
  }
  if (upstream) { upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)) }
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, 'browser-dot.json'), JSON.stringify(report, null, 2) + '\n')
}
async function listCheck() {
  const current = await state()
  assert.equal(current.hash, resultsHash(query))
  assert.deepEqual(current.inputs, Object.values(query.filters))
}
