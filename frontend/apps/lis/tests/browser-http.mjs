import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { before, after, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'

const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.2-2026-11-03/list-regression'))
mkdirSync(evidence, { recursive: true })
const report = { source: 'HTTP mô phỏng bằng Chrome CDP Fetch; giao diện production thật', startedAt: new Date().toISOString(), cases: [] }
let browser, respond, current

function rows(count, prefix, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    result_id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    patient_id: `P-${prefix}`, test_code: `T-${prefix}`, test_name: 'Xét nghiệm mô phỏng',
    fluid: null, category: null, value_num: String(index + 1), unit: 'mg/dL',
    reference_low: null, reference_high: null, effective_at: '2180-06-03T12:34:56.123456Z',
    result_status: 'FINAL', ...overrides,
  }))
}

function success(dataset, request) {
  const q = request.query
  const matching = dataset.filter((row) => (!q.patient_id || row.patient_id === q.patient_id)
    && (!q.test_code || row.test_code === q.test_code)
    && (!q.result_status || row.result_status === q.result_status))
  const offset = Number(q.offset), limit = Number(q.limit)
  return { json: { items: matching.slice(offset, offset + limit), limit, offset } }
}

before(async () => {
  browser = await openHttpBrowser((request) => respond(request))
  report.browser = browser.version
  report.executable = browser.executable
})

after(async () => {
  if (browser) {
    report.requests = browser.requests
    report.exceptions = browser.exceptions
    report.interceptionErrors = browser.interceptionErrors
    await browser.close()
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, 'http-browser.json'), JSON.stringify(report, null, 2) + '\n')
})

async function runCase(t, id, action) {
  current = { id, name: t.name, steps: [], requestStart: browser.requests.length }
  report.cases.push(current)
  try {
    await action()
    assert.deepEqual(browser.interceptionErrors, [])
    assert.deepEqual(browser.exceptions, [])
    current.result = 'PASS'
  } catch (error) {
    current.result = 'FAIL'
    current.error = String(error.stack ?? error)
    try { await snapshot('FAIL') } catch { /* Giữ lỗi kiểm thử ban đầu. */ }
    throw error
  } finally {
    current.requestEnd = browser.requests.length
  }
}

async function snapshot(label) {
  const state = await browser.evaluate(() => ({
    busy: document.querySelector('.results-content')?.getAttribute('aria-busy'),
    page: document.querySelector('.results-pagination p')?.textContent,
    ids: [...document.querySelectorAll('tbody tr')].map((row) => row.cells[0].textContent),
    values: [...document.querySelectorAll('tbody tr')].map((row) => row.cells[4].textContent),
    patients: [...document.querySelectorAll('tbody tr')].map((row) => row.cells[1].textContent),
    statuses: [...document.querySelectorAll('tbody tr')].map((row) => row.cells[7].textContent),
    buttons: Object.fromEntries([...document.querySelectorAll('button')].filter((b) => b.closest('nav') || b.closest('[role="alert"]')).map((b) => [b.textContent.trim(), !b.disabled])),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    content: document.querySelector('.results-content')?.textContent,
    draft: ['patient-id', 'test-code', 'result-status'].map((id) => document.getElementById(id)?.value),
  }))
  current.steps.push({ label, ...state, lastRequest: browser.requests.length - 1 })
  return state
}

async function settledSince(previous) {
  await until(async () => browser.requests.length > previous
    && browser.requests.at(-1).fulfilled
    && await browser.evaluate(() => document.querySelector('.results-content')?.getAttribute('aria-busy') === 'false'), 'hoàn tất HTTP và giao diện')
}

async function navigate() {
  const previous = browser.requests.length
  await browser.navigate()
  await settledSince(previous)
}

async function click(text, disabled = false) {
  await browser.evaluate(({ text, disabled }) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    if (!button || button.disabled !== disabled) throw new Error('Trạng thái nút sai: ' + text)
    button.click()
  }, { text, disabled })
}

async function action(text) {
  const previous = browser.requests.length
  await click(text)
  await settledSince(previous)
}

async function setFilters(patient, code, status) {
  for (const [id, value] of [['patient-id', patient], ['test-code', code], ['result-status', status]]) {
    await browser.evaluate(({ id, value }) => {
      const input = document.getElementById(id)
      const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    }, { id, value })
  }
}

function assertQuery(filters, page) {
  assert.deepEqual(browser.requests.at(-1).query, { limit: '11', offset: String(page * 10), ...filters })
}

async function checkPage(dataset, page, filters, label) {
  const state = await snapshot(label)
  const expected = dataset.slice(page * 10, page * 10 + 10).map((row) => row.result_id)
  assertQuery(filters, page)
  assert.equal(state.busy, 'false')
  assert.equal(state.alert, null)
  assert.deepEqual(state.ids, expected)
  assert.equal(state.ids.length, Math.min(10, dataset.length - page * 10))
  assert.equal(state.page, `Trang ${page + 1}`)
  assert.equal(state.buttons['Trang trước'], page > 0)
  assert.equal(state.buttons['Trang sau'], (page + 1) * 10 < dataset.length)
  assert.ok(state.ids.length > 0, 'Không có trang rỗng thừa')
  return state.ids
}

async function disabledDoesNothing(text) {
  const previous = browser.requests.length
  const before = await browser.evaluate(() => document.querySelector('tbody')?.textContent)
  await click(text, true)
  await delay(150)
  assert.equal(browser.requests.length, previous)
  assert.equal(await browser.evaluate(() => document.querySelector('tbody')?.textContent), before)
}

for (const total of [10, 11, 20, 21]) {
  test(`P${total}: ${total} bản ghi, đi tới/quay lại, limit/offset, dòng và nút`, async (t) => runCase(t, `P${total}`, async () => {
    const dataset = rows(total, `N${total}`)
    respond = (request) => success(dataset, request)
    await navigate()
    await checkPage(dataset, 0, {}, 'Mở giao diện')
    const filters = { patient_id: `P-N${total}`, test_code: `T-N${total}`, result_status: 'FINAL' }
    await setFilters(filters.patient_id, filters.test_code, filters.result_status)
    await action('Tìm kiếm')
    const first = await checkPage(dataset, 0, filters, 'Trang đầu sau tìm kiếm')
    await disabledDoesNothing('Trang trước')
    const forward = [...first], last = Math.ceil(total / 10) - 1
    const requestStart = browser.requests.length
    const offsets = []
    // Sửa bản nháp không được đổi bộ lọc áp dụng khi chuyển trang.
    await setFilters('DRAFT-NOT-APPLIED', 'DRAFT-NOT-APPLIED', 'READY')
    for (let page = 1; page <= last; page++) {
      await action('Trang sau')
      offsets.push(String(page * 10))
      forward.push(...await checkPage(dataset, page, filters, 'Đi tới'))
    }
    await disabledDoesNothing('Trang sau')
    assert.deepEqual(forward, dataset.map((row) => row.result_id))
    assert.equal(new Set(forward).size, total, 'Không trùng/mất kết quả khi đi tới')
    const reversePages = []
    for (let page = last - 1; page >= 0; page--) {
      await action('Trang trước')
      offsets.push(String(page * 10))
      reversePages.unshift(...await checkPage(dataset, page, filters, 'Quay lại'))
    }
    assert.deepEqual(reversePages, dataset.slice(0, last * 10).map((row) => row.result_id))
    await disabledDoesNothing('Trang trước')
    for (let page = 1; page <= last; page++) {
      await action('Trang sau')
      offsets.push(String(page * 10))
      await checkPage(dataset, page, filters, 'Đi tới lần hai')
    }
    assert.deepEqual(browser.requests.slice(requestStart).map((r) => r.query.offset), offsets)
    current.forwardIds = forward
    current.expectedTotal = total
  }))
}

for (const [id, value] of [['V0', '0'], ['VNEG', '-2.50'], ['VLONG', '12345678901234567890.123456789012345678901234567890']]) {
  test(`${id}: nội dung ô giá trị giữ nguyên "${value}"`, async (t) => runCase(t, id, async () => {
    const dataset = rows(1, id, { value_num: value })
    respond = (request) => success(dataset, request)
    await navigate()
    const state = await snapshot('Ô thứ tư trong dòng kết quả sau HTTP 200')
    assert.deepEqual(state.ids, [dataset[0].result_id])
    assert.deepEqual(state.values, [value])
    assert.equal(state.alert, null)
    assertQuery({}, 0)
  }))
}

async function screenshot(name) {
  const file = `${name}.png`
  writeFileSync(path.join(evidence, file), Buffer.from(await browser.screenshot(), 'base64'))
  current.screenshots = [...(current.screenshots ?? []), file]
}

for (const status of [503, 400, 502]) {
  test(`E${status}: lỗi HTTP, ẩn dữ liệu cũ, phục hồi đúng bộ lọc/trang`, async (t) => runCase(t, `E${status}`, async () => {
    const old = rows(11, `OLD${status}`)
    const filtered = rows(21, `NEW${status}`)
    const corrected = rows(11, `FIX${status}`, { result_status: 'READY' })
    const dataset = [...old, ...filtered, ...corrected]
    respond = (request) => success(dataset, request)
    await navigate()
    assert.deepEqual((await snapshot('Kết quả cũ')).ids, old.slice(0, 10).map((r) => r.result_id))
    const filters = { patient_id: `P-NEW${status}`, test_code: `T-NEW${status}`, result_status: 'FINAL' }
    await setFilters(filters.patient_id, filters.test_code, filters.result_status)
    if (status !== 400) {
      await action('Tìm kiếm')
      await checkPage(filtered, 0, filters, 'Kết quả mới trang 1 trước lỗi trang 2')
    }
    let release
    const gate = new Promise((resolve) => { release = resolve })
    respond = async () => {
      await gate
      return status === 502
        ? { status, html: '<!doctype html><html><body>Bad Gateway - upstream unavailable</body></html>' }
        : { status, json: { error: { code: status === 400 ? 'VALIDATION_ERROR' : 'DEPENDENCY_UNAVAILABLE', message: 'Lỗi HTTP mô phỏng' } } }
    }
    const previous = browser.requests.length
    await click(status === 400 ? 'Tìm kiếm' : 'Trang sau')
    await until(async () => browser.requests.length > previous && await browser.evaluate(() => document.querySelector('.results-content')?.getAttribute('aria-busy') === 'true'), 'giao diện đang chờ HTTP bị giữ')
    try {
      const loading = await snapshot('Đang tải truy vấn/trang mới, HTTP chưa trả')
      assert.equal(loading.busy, 'true')
      assert.deepEqual(loading.ids, [], 'Dữ liệu cũ phải bị ẩn ngay trong lúc tải')
      assert.equal(loading.buttons['Trang trước'], false)
      assert.equal(loading.buttons['Trang sau'], false)
    } finally { release() }
    await settledSince(previous)
    const failed = await snapshot(`HTTP ${status}`)
    assertQuery(filters, status === 400 ? 0 : 1)
    assert.deepEqual(failed.ids, [])
    assert.ok(failed.alert.includes(`HTTP ${status}`))
    assert.ok(!failed.alert.includes('<html>') && !failed.alert.includes('upstream unavailable'))
    assert.equal(failed.buttons['Thử tải lại'], true)
    assert.equal(failed.page, status === 400 ? 'Trang 1' : 'Trang 2')
    await screenshot(`E${status}-error`)
    respond = (request) => success(dataset, request)
    if (status === 400) {
      const fixed = { patient_id: `P-FIX${status}`, test_code: `T-FIX${status}`, result_status: 'READY' }
      await setFilters(fixed.patient_id, fixed.test_code, fixed.result_status)
      await action('Tìm kiếm')
      await checkPage(corrected, 0, fixed, 'Sửa cả ba bộ lọc, tìm kiếm thành công')
      await action('Trang sau')
      await checkPage(corrected, 1, fixed, 'Trang 2 sau sửa bộ lọc')
    } else {
      // Thử lại phải dùng bộ lọc đã áp dụng, kể cả bản nháp đã thay đổi.
      await setFilters('DRAFT-OTHER', 'DRAFT-OTHER', 'READY')
      await action('Thử tải lại')
      await checkPage(filtered, 1, filters, 'Thử lại HTTP 200 đúng trang 2/bộ lọc đã áp dụng')
      await action('Trang sau')
      await checkPage(filtered, 2, filters, 'Trang cuối sau phục hồi')
      await disabledDoesNothing('Trang sau')
      await action('Trang trước')
      await checkPage(filtered, 1, filters, 'Quay lại sau phục hồi')
    }
    await screenshot(`E${status}-recovered`)
  }))
}
