import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'
import { parseResultsHash, resultsHash } from '../src/state/routes.ts'
import { initialQuery } from '../src/state/results.ts'
import { lisResultRequest } from '../src/api/resultRequest.ts'

const real = process.argv.includes('--real')
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.2-conditions-2026-11-03'))
mkdirSync(evidence, { recursive: true })
const filters = { patient_id: 'MIMIC-P-10007928', test_code: '50912', result_status: 'FINAL' }
const report = {
  source: real ? 'Chrome + API LIS thật, không chặn hoặc thay phản hồi HTTP' : 'Chrome + HTTP mô phỏng riêng bằng CDP; 31 bản ghi và 3 dòng đối chứng; không ghi database',
  startedAt: new Date().toISOString(), completed: false, steps: [], apiCalls: [],
}
let browser
const fixture = {
  result_id: 'MOCK-TRIPLE-01', patient_id: filters.patient_id, test_code: filters.test_code,
  test_name: 'Creatinine — HTTP mô phỏng', fluid: 'Blood', category: 'Chemistry',
  value_num: '0.9', unit: 'mg/dL', reference_low: '0.4', reference_high: '1.1',
  effective_at: '2129-04-05T21:30:00.000000Z', result_status: 'FINAL',
}
const dataset = Array.from({ length: 31 }, (_, i) => ({ ...fixture, result_id: 'MOCK-TRIPLE-' + String(i + 1).padStart(2, '0') }))
dataset.push({ ...fixture, result_id: 'MOCK-WRONG-PATIENT', patient_id: 'OTHER' },
  { ...fixture, result_id: 'MOCK-WRONG-TEST', test_code: 'OTHER' },
  { ...fixture, result_id: 'MOCK-WRONG-STATUS', result_status: 'READY' })
function simulated(request) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/lis/results') {
    const id = decodeURIComponent(url.pathname.slice('/api/lis/results/'.length))
    const row = dataset.find((r) => r.result_id === id)
    return row ? { json: row } : { status: 404, json: { error: { code: 'NOT_FOUND' } } }
  }
  const matches = dataset.filter((r) => Object.entries(filters).every(([key]) => !request.query[key] || r[key] === request.query[key]))
  const limit = Number(request.query.limit), offset = Number(request.query.offset)
  return { json: { items: matches.slice(offset, offset + limit), limit, offset } }
}
async function api(suffix) {
  const url = 'http://127.0.0.1:3101/api/results' + suffix
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  report.apiCalls.push({ method: 'GET', url, status: response.status, body })
  assert.equal(response.status, 200)
  return body
}
function observeFetch() {
  // Quan sát thụ động: gọi fetch gốc với toàn bộ arguments/signal; chỉ đọc clone.
  // Không thay body, status, timing có chủ ý hoặc dữ liệu trong ứng dụng.
  const original = window.fetch
  window.conditionDocument = crypto.randomUUID()
  window.conditionHttp = []
  window.fetch = async function (...args) {
    const [input, options] = args
    if (String(input).includes('/publish-event')) return original.apply(this, args)
    const entry = {
      url: new URL(typeof input === 'string' ? input : input.url, location.href).href,
      method: options?.method ?? 'GET', startedAt: new Date().toISOString(), complete: false,
    }
    window.conditionHttp.push(entry)
    try {
      const response = await original.apply(this, args)
      entry.status = response.status
      entry.responseURL = response.url
      response.clone().text().then((text) => {
        entry.text = text
        try { entry.body = JSON.parse(text) } catch { entry.body = null }
        entry.complete = true
      }).catch((error) => { entry.readError = String(error); entry.complete = true })
      return response
    } catch (error) {
      entry.networkError = String(error)
      entry.complete = true
      throw error
    }
  }
}
const evaluate = (fn, value) => browser.evaluate(fn, value)
async function dom() {
  return evaluate(() => ({
    hash: location.hash, documentId: window.conditionDocument,
    inputs: ['patient-id', 'test-code', 'result-status'].map((id) => document.getElementById(id)?.value ?? null),
    page: document.querySelector('.results-pagination p')?.textContent ?? null,
    listBusy: document.querySelector('.results-content')?.getAttribute('aria-busy') ?? null,
    detailBusy: document.querySelector('.detail-content')?.getAttribute('aria-busy') ?? null,
    rows: [...document.querySelectorAll('tbody tr')].map((row) => ({
      result_id: row.cells[0].textContent, patient_id: row.cells[1].textContent,
      test_code: row.cells[2].textContent, test_name: row.cells[3].textContent, value_num: row.cells[4].textContent,
      unit: row.cells[5].textContent, effective_at: row.cells[6].querySelector('time')?.getAttribute('datetime') ?? null,
      result_status: row.cells[7].textContent.trim(),
    })),
    fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map((node) => [node.dataset.field,
      node.dataset.field === 'effective_at' ? {
        text: node.textContent, datetime: node.querySelector('time')?.getAttribute('datetime') ?? null,
        title: node.querySelector('time')?.title ?? null,
      } : node.textContent])),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    http: window.conditionHttp ?? [],
  }))
}
async function click(text, id) {
  await evaluate(({ text, id }) => {
    const root = id ? [...document.querySelectorAll('tbody tr')].find((row) => row.cells[0].textContent === id) : document
    const button = root && [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('Không có nút khả dụng: ' + text + ' / ' + id)
    button.click()
  }, { text, id })
}
async function input(id, value) {
  await evaluate(({ id, value }) => {
    const node = document.getElementById(id)
    const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }, { id, value })
}
function query(page) {
  return { limit: '11', offset: String((page - 1) * 10), ...filters }
}
function hashFor(page, id) {
  return resultsHash({ filters: { patientId: filters.patient_id, testCode: filters.test_code, resultStatus: filters.result_status }, pageIndex: page - 1 }, id)
}
function assertList(state, page, expected) {
  assert.equal(state.hash, hashFor(page))
  assert.equal(state.page, 'Trang ' + page)
  assert.equal(state.listBusy, 'false')
  assert.deepEqual(state.inputs, Object.values(filters))
  const httpEntry = state.http.at(-1)
  assert.equal(httpEntry.method, 'GET')
  assert.equal(httpEntry.status, 200)
  assert.deepEqual(Object.fromEntries(new URL(httpEntry.url).searchParams), query(page))
  assert.deepEqual(httpEntry.body, expected)
  const visible = expected.items.slice(0, 10).map((r) => Object.fromEntries(Object.keys(state.rows[0] ?? {}).map((key) => [key, r[key]])))
  assert.deepEqual(state.rows, visible)
  assert.equal(state.rows.length, Math.min(10, expected.items.length))
}
function assertDetail(state, page, expected) {
  assert.equal(state.hash, hashFor(page, expected.result_id))
  assert.equal(state.detailBusy, 'false')
  const entry = state.http.at(-1)
  assert.equal(entry.method, 'GET')
  assert.equal(entry.status, 200)
  const url = new URL(entry.url)
  assert.equal(url.pathname, '/api/lis/results/' + encodeURIComponent(expected.result_id))
  assert.equal(url.search, '')
  assert.deepEqual(entry.body, expected)
  const displayed = Object.fromEntries(Object.entries(expected).map(([key, value]) => [
    key, key === 'effective_at' ? {
      text: value === null ? '—' : value.slice(0, 19).replace('T', ' '),
      datetime: value, title: value,
    } : value ?? '—',
  ]))
  assert.deepEqual(state.fields, displayed)
}
async function step(name, action, check, reload = false) {
  const previous = browser.requests.length
  const documentId = await evaluate(() => window.conditionDocument)
  const item = { name, previousRequestCount: previous }
  report.steps.push(item)
  try {
    await action()
    await until(async () => {
      if (browser.requests.length <= previous) return false
      const state = await dom()
      if (reload && state.documentId === documentId) return false
      return state.http.at(-1)?.complete
        && (state.detailBusy === 'false' || state.listBusy === 'false')
    }, name + ': request mới hoàn tất và DOM ổn định')
    const state = await dom()
    check(state)
    assert.equal(state.alert, null)
    assert.deepEqual(browser.exceptions, [])
    assert.deepEqual(browser.interceptionErrors, [])
    item.state = state
    item.requestEnd = browser.requests.length
    item.requests = browser.requests.slice(previous)
    item.result = 'PASS'
    console.log('PASS: ' + name)
  } catch (error) {
    item.result = 'FAIL'
    item.error = String(error.stack ?? error)
    throw error
  }
}
async function rawGet(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: 3101, path: pathname, timeout: 10000 }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (part) => { text += part })
      response.on('end', () => {
        let body
        try { body = JSON.parse(text) } catch { body = text }
        resolve({ method: 'GET', path: pathname, status: response.statusCode, body })
      })
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('timeout')))
  })
}
async function investigateDots() {
  const dot = { source: 'Hợp đồng/mã hiện có + Chrome thật + raw HTTP GET backend thật; không có fixture dot trong database', status: 'PASS_ROUTING_404_ONLY', cases: [] }
  report.dotCondition = dot
  for (const id of ['.', '..']) {
    const hash = resultsHash(initialQuery, id)
    const record = { id, hash, parsed: parseResultsHash(hash), rawBackend: await rawGet('/api/results/' + id) }
    assert.equal(record.rawBackend.status, 404)
    assert.equal(record.rawBackend.body.error.code, 'NOT_FOUND')
    // Backend đi vào lookup, không trả VALIDATION_ERROR; không có bản ghi để chứng minh200.
    const before = browser.requests.length

    await browser.navigate(hash)
    await until(async () => browser.requests.length > before && await evaluate((expectedHash) =>
      location.hash === expectedHash && document.querySelector('.detail-content')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('[role="alert"]')?.textContent.includes('HTTP 404'), hash), 'dot ID đi đến lookup backend')
    record.browser = await dom()
    record.noApplicationGET = browser.requests.length === before
    assert.equal(record.browser.hash, hash)
    assert.equal(record.parsed.kind, 'detail')
    assert.equal(record.noApplicationGET, false)
    assert.equal(new URL(browser.requests.at(-1).url).pathname, lisResultRequest(id).path)
    assert.equal(record.browser.http.at(-1).status, 404)
    assert.equal(record.browser.http.at(-1).body.error.message, 'Laboratory result not found')
    record.normalization = await evaluate(async (id) => {
      const raw = '/api/lis/results/' + id
      const encoded = '/api/lis/results/' + id.replaceAll('.', '%2E')
      const double = '/api/lis/results/' + id.replaceAll('.', '%252E')
      const probes = []
      for (const path of [raw, encoded, double]) {
        const response = await fetch(path)
        const text = await response.text()
        let body
        try { body = JSON.parse(text) } catch { body = text }
        probes.push({ input: path, normalizedPath: new URL(path, location.href).pathname,
          responseURL: response.url, status: response.status, body })
      }
      return probes
    }, id)
    record.encodedRawBackend = await rawGet('/api/results/' + id.replaceAll('.', '%2E'))
    assert.equal(record.encodedRawBackend.body.error.code, 'NOT_FOUND')
    record.doubleDecodedId = decodeURIComponent(id.replaceAll('.', '%252E'))
    assert.notEqual(record.doubleDecodedId, id)
    dot.cases.push(record)
  }
  dot.conclusion = 'PASS: hash nhận dot ID và GET qua proxy trả404 lookup hợp lệ. Không có dot record thật để chứng minh200; raw fetch không marker vẫn chuẩn hóa như các probe độc lập bên dưới.'
  console.log('PASS: dot ID được gửi qua proxy đến backend;404 vì chưa có bản ghi thật')
}
try {
  let expectedFirst, expectedPage, expectedDetail, chosenId
  if (real) {
    expectedFirst = await api('?' + new URLSearchParams(query(1)))
    assert.equal(expectedFirst.items.length, 2)
    expectedDetail = await api('/MIMIC-LAB-100142')
    assert.equal(expectedDetail.result_id, 'MIMIC-LAB-100142')
    assert.ok(expectedFirst.items.some((r) => r.result_id === expectedDetail.result_id))
    for (const [key, value] of Object.entries(filters)) assert.equal(expectedDetail[key], value)
    const second = await api('?' + new URLSearchParams(query(2)))
    report.realPagination = { firstPageSize: expectedFirst.items.length, secondPageSize: second.items.length, hasNext: expectedFirst.items.length > 10 }
    assert.equal(second.items.length, 0)
    expectedPage = expectedFirst
    chosenId = expectedDetail.result_id
  } else {
    expectedFirst = { items: dataset.slice(0, 11), limit: 11, offset: 0 }
    expectedPage = { items: dataset.slice(20, 31), limit: 11, offset: 20 }
    expectedDetail = dataset[20]
    chosenId = expectedDetail.result_id
  }
  browser = await openHttpBrowser(real ? undefined : simulated)
  report.browser = browser.version
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: '(' + observeFetch.toString() + ')()' })
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  await step('Mở danh sách mặc định', () => browser.navigate(), (state) => {
    assert.equal(state.listBusy, 'false')
    assert.ok(state.rows.length > 0)
  }, true)
  const beforeTyping = browser.requests.length
  for (const [id, value] of [['patient-id', filters.patient_id], ['test-code', filters.test_code], ['result-status', filters.result_status]]) await input(id, value)
  assert.equal(browser.requests.length, beforeTyping)
  await step('Tìm kiếm đồng thời ba bộ lọc', () => click('Tìm kiếm'), (state) => assertList(state, 1, expectedFirst))
  const page = real ? 1 : 3
  if (!real) {
    await step('Ba bộ lọc sang trang 2', () => click('Trang sau'), (state) => assertList(state, 2, { items: dataset.slice(10, 21), limit: 11, offset: 10 }))
    await step('Ba bộ lọc sang trang 3', () => click('Trang sau'), (state) => assertList(state, 3, expectedPage))
  }
  await step('Mở đúng chi tiết từ dòng ' + chosenId, () => click('Xem chi tiết', chosenId), (state) => assertDetail(state, page, expectedDetail))
  writeFileSync(path.join(evidence, real ? 'three-filters-real-detail.png' : 'three-filters-mock-detail.png'), Buffer.from(await browser.screenshot(), 'base64'))
  await step('F5 chi tiết: tài liệu mới, đúng ID và ngữ cảnh', () => browser.command('Page.reload'), (state) => assertDetail(state, page, expectedDetail), true)
  await step('Quay lại giữ đủ ba bộ lọc và trang', () => click('Quay lại danh sách'), (state) => assertList(state, page, expectedPage))
  await step('F5 danh sách: tài liệu mới, đúng ba bộ lọc và trang', () => browser.command('Page.reload'), (state) => assertList(state, page, expectedPage), true)
  await step('Back về chi tiết đúng ID/context', () => evaluate(() => history.back()), (state) => assertDetail(state, page, expectedDetail))
  await step('Forward về danh sách đúng ba bộ lọc/trang', () => evaluate(() => history.forward()), (state) => assertList(state, page, expectedPage))
  writeFileSync(path.join(evidence, real ? 'three-filters-real-list.png' : 'three-filters-mock-page3.png'), Buffer.from(await browser.screenshot(), 'base64'))
  report.threeFiltersCondition = { status: 'PASS', page, chosenId, filters }
  if (real) await investigateDots()
  assert.ok(browser.requests.every((q) => q.method === 'GET'))
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.interceptionErrors, [])
  report.completed = true
} finally {
  if (browser) {
    report.requests = browser.requests
    report.exceptions = browser.exceptions
    report.interceptionErrors = browser.interceptionErrors
    await browser.close()
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, real ? 'conditions-real.json' : 'conditions-mock.json'), JSON.stringify(report, null, 2) + '\n')
}
