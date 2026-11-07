import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'

const real = process.argv.includes('--real')
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.2-uiux-2026-11-04', real ? 'real' : 'mock'))
mkdirSync(evidence, { recursive: true })
const sample = {
  result_id: 'MIMIC-LAB-100145', patient_id: 'MIMIC-P-10007928', test_code: '50971',
  test_name: 'Potassium', fluid: 'Blood', category: 'Chemistry', value_num: '3.6', unit: 'mEq/L',
  reference_low: '3.3', reference_high: '5.1', effective_at: '2129-04-05T21:30:00.000000Z', result_status: 'FINAL',
}
const data = Array.from({ length: 31 }, (_, i) => ({ ...sample, result_id: i === 30 ? sample.result_id : 'ROW-' + i }))
const report = { source: real ? 'Chrome + API LIS thật qua proxy, chỉ GET, không chặn HTTP' : 'Chrome + HTTP mô phỏng CDP, không ghi database', checks: [], startedAt: new Date().toISOString(), completed: false }
let browser, override
function normal(request) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/lis/results') {
    const id = decodeURIComponent(url.pathname.slice('/api/lis/results/'.length))
    const row = data.find((row) => row.result_id === id)
    return row ? { json: row } : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'Laboratory result not found' } } }
  }
  const q = request.query
  const rows = data.filter((row) => ['patient_id', 'test_code', 'result_status'].every((key) => !q[key] || row[key] === q[key]))
  const limit = Number(q.limit), offset = Number(q.offset)
  return { json: { items: rows.slice(offset, offset + limit), limit, offset } }
}
function observe() {
  window.uiHttp = []
  const original = window.fetch
  window.fetch = async (...args) => {
    if (String(args[0]).includes('/publish-event') || String(args[0]).includes('/api/middleware/')) return original(...args)
    const entry = { url: args[0], headers: args[1]?.headers, complete: false }
    window.uiHttp.push(entry)
    try {
      const response = await original(...args)
      entry.status = response.status
      response.clone().text().then((text) => {
        try { entry.body = JSON.parse(text) } catch { entry.body = text }
        entry.complete = true
      }).catch((error) => { entry.readError = String(error); entry.complete = true })
      return response
    } catch (error) { entry.error = String(error); entry.complete = true; throw error }
  }
}
const evaluate = (fn, value) => browser.evaluate(fn, value)
async function state() {
  return evaluate(() => ({
    hash: location.hash, busy: document.querySelector('.results-content')?.getAttribute('aria-busy'),
    draft: Object.fromEntries(['patient-id', 'result-id', 'test-code', 'result-status'].map((id) => [id, document.getElementById(id)?.value])),
    page: document.querySelector('.results-pagination p')?.textContent ?? null,
    headers: [...document.querySelectorAll('thead th')].map((n) => n.textContent),
    rows: [...document.querySelectorAll('tbody tr')].map((r) => [...r.cells].slice(0, 8).map((n) => n.textContent.trim())),
    fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map((n) => [n.dataset.field, n.dataset.field === 'effective_at' ? n.querySelector('time')?.getAttribute('datetime') ?? null : n.textContent])),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    content: document.querySelector('.results-content')?.textContent,
    http: window.uiHttp,
    noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
    cardColumns: document.querySelector('.result-detail-grid') ? getComputedStyle(document.querySelector('.result-detail-grid')).gridTemplateColumns.split(' ').length : null,
    filterColumns: document.querySelector('.result-filters') ? getComputedStyle(document.querySelector('.result-filters')).gridTemplateColumns.split(' ').length : null,
  }))
}
async function settled() {
  await until(async () => await evaluate(() => document.querySelector('.results-content')?.getAttribute('aria-busy') === 'false' && window.uiHttp.at(-1)?.complete), 'danh sách hoàn tất')
}
async function navigate(hash = '#/results') { await browser.navigate(hash); await settled() }
async function click(text) {
  await evaluate((text) => {
    const node = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    if (!node || node.disabled) throw new Error('Nút không khả dụng: ' + text)
    node.click()
  }, text)
}
async function input(id, value) {
  await evaluate(({ id, value }) => {
    const node = document.getElementById(id)
    const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }, { id, value })
}
async function search(values) {
  for (const id of ['patient-id', 'result-id', 'test-code', 'result-status']) await input(id, values[id] ?? '')
  const before = await evaluate(() => window.uiHttp.length)
  await click('Tìm kiếm')
  await until(async () => await evaluate((n) => window.uiHttp.length > n, before), 'GET tìm kiếm mới')
  await settled()
  return state()
}
async function detail() {
  await until(async () => await evaluate(() => document.querySelectorAll('[data-field]').length === 12 && document.querySelector('.detail-content')?.getAttribute('aria-busy') === 'false'), '12 trường chi tiết')
}
async function screenshot(name) {
  const { cssContentSize } = await browser.command('Page.getLayoutMetrics')
  const { data } = await browser.command('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
  })
  writeFileSync(path.join(evidence, name + '.png'), Buffer.from(data, 'base64'))
}
async function check(name, action) {
  const entry = { name, requestStart: browser.requests.length }
  report.checks.push(entry)
  try {
    await action()
    assert.deepEqual(browser.exceptions, [])
    assert.deepEqual(browser.interceptionErrors, [])
    entry.result = 'PASS'
    console.log('PASS: ' + name)
  } catch (error) {
    entry.result = 'FAIL'; entry.error = String(error.stack ?? error)
    await screenshot('FAIL-' + report.checks.length)
    throw error
  } finally { entry.dom = await state(); entry.requestEnd = browser.requests.length }
}
function assertTable(s, expected) {
  assert.equal(s.alert, null)
  assert.deepEqual(s.rows, expected.slice(0, 10).map((r) => [r.result_id, r.patient_id, r.test_code, r.test_name, r.value_num, r.unit, r.effective_at?.slice(0, 19).replace('T', ' ') ?? '—', r.result_status]))
  assert.equal(s.headers.length, expected.length ? 9 : 0)
}
async function directExpected(filters) {
  if (!real) return data.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value))
  const params = new URLSearchParams({ limit: '11', offset: '0', ...filters })
  const response = await fetch('http://127.0.0.1:3101/api/results?' + params)
  assert.equal(response.status, 200)
  return (await response.json()).items
}
try {
  browser = await openHttpBrowser(real ? undefined : (request) => override ? override(request) : normal(request))
  report.browser = browser.version; report.executable = browser.executable
  assert.match(browser.executable, /Chrome/i)
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: '(' + observe.toString() + ')()' })
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await check('Danh sách: 4 ô đúng thứ tự, 2 cột, 9 cột bảng, dữ liệu khớp API', async () => {
    await navigate()
    const s = await state()
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('.filter-field label')].map((n) => n.textContent)), ['Mã bệnh nhân', 'Mã kết quả xét nghiệm', 'Mã loại xét nghiệm', 'Trạng thái kết quả'])
    assert.equal(s.filterColumns, 2)
    assertTable(s, await directExpected({}))
    await screenshot('list-desktop')
  })
  for (const patient of ['MIMIC-P-10007928', 'mimic-p-10007928', '  mimic-p-10007928  ']) {
    await check('Bệnh nhân: ' + JSON.stringify(patient), async () => {
      const s = await search({ 'patient-id': patient })
      assert.equal(new URL(s.http.at(-1).url, 'http://localhost').searchParams.get('patient_id'), sample.patient_id)
      assertTable(s, await directExpected({ patient_id: sample.patient_id }))
      assert.ok(s.rows.length > 0)
    })
  }
  for (const id of ['MIMIC-LAB-100145', 'mimic-lab-100145', '  MiMiC-LaB-100145  ']) {
    await check('Mã kết quả trực tiếp: ' + JSON.stringify(id), async () => {
      const previous = browser.requests.length
      const s = await search({ 'result-id': id })
      assert.equal(browser.requests.length, previous + 1)
      assert.equal(s.http.at(-1).url, '/api/lis/results/' + sample.result_id)
      assertTable(s, [sample]); assert.equal(s.page, null)
      assert.equal(s.draft['result-id'], sample.result_id)
    })
  }
  await check('Mã loại xét nghiệm 50971: lọc toàn bộ qua API', async () => {
    const s = await search({ 'test-code': ' 50971 ' })
    assertTable(s, await directExpected({ test_code: '50971' }))
    assert.ok(s.rows.length > 0)
  })
  const combined = { 'patient-id': sample.patient_id, 'result-id': sample.result_id, 'test-code': '50971', 'result-status': 'FINAL' }
  await check('Bốn điều kiện tương thích; URL và F5/chi tiết/quay lại/Back/Forward', async () => {
    let s = await search(combined)
    assertTable(s, [sample])
    const hash = s.hash
    await screenshot('list-result-combined')
    await click('Xem chi tiết'); await detail()
    const expectedFields = Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, k === 'effective_at' ? v : v ?? '—']))
    assert.deepEqual((await state()).fields, expectedFields)
    assert.equal((await state()).cardColumns, 2)
    await screenshot('detail-desktop')
    await browser.command('Page.reload'); await detail()
    assert.deepEqual((await state()).fields, expectedFields)
    await click('Quay lại danh sách'); await settled()
    assert.equal((await state()).hash, hash)
    assertTable(await state(), [sample])
    await browser.command('Page.reload'); await settled()
    assertTable(await state(), [sample])
    await evaluate(() => history.back()); await detail()
    await evaluate(() => history.forward()); await settled()
    s = await state(); assert.equal(s.hash, hash); assertTable(s, [sample])
  })
  for (const mismatch of [{ 'patient-id': 'OTHER' }, { 'test-code': '50912' }, { 'result-status': 'READY' }]) {
    await check('AND không tương thích: ' + JSON.stringify(mismatch), async () => {
      const s = await search({ ...combined, ...mismatch })
      assert.equal(s.rows.length, 0); assert.equal(s.alert, null); assert.match(s.content, /Không có kết quả/)
      assert.equal(s.http.at(-1).status, 200)
      assert.equal(s.page, null)
    })
  }
  for (const values of [{ 'result-id': 'MIMIC-LAB-999999999999999999' }, { 'patient-id': 'mimic-p-999999999999999999' }, { 'test-code': 'DOES-NOT-EXIST' }]) {
    await check('Mã không tồn tại: ' + JSON.stringify(values), async () => {
      const s = await search(values)
      assert.equal(s.rows.length, 0); assert.equal(s.alert, null); assert.match(s.content, /Không có kết quả/)
      if (values['result-id']) assert.equal(s.http.at(-1).status, 404)
      await screenshot('empty-' + Object.keys(values)[0])
    })
  }
  await check('Nhập nhầm MIMIC-LAB vào mã loại: gợi ý, không chuyển/xóa bộ lọc', async () => {
    const s = await search({ 'test-code': 'mimic-lab-100145' })
    assert.equal(s.draft['test-code'], 'mimic-lab-100145')
    assert.equal(s.draft['result-id'], '')
    assert.match(await evaluate(() => document.getElementById('test-code-hint')?.textContent), /mã kết quả/)
    assert.equal(new URL(s.http.at(-1).url, 'http://localhost').searchParams.get('test_code'), 'mimic-lab-100145')
    assert.match(s.content, /Không có kết quả/)
  })
  await check('Xóa cả 4 ô, phân trang và giữ bản nháp chưa áp dụng', async () => {
    await search(combined)
    await click('Xóa bộ lọc'); await settled()
    let s = await state()
    assert.deepEqual(Object.values(s.draft), ['', '', '', '']); assert.equal(s.hash, '#/results')
    assert.equal(s.page, 'Trang 1')
    const first = s.rows
    await input('result-id', 'DRAFT-DO-NOT-APPLY')
    await click('Trang sau'); await settled()
    s = await state(); assert.equal(s.page, 'Trang 2'); assert.notDeepEqual(s.rows, first)
    assert.equal(new URL(s.http.at(-1).url, 'http://localhost').searchParams.get('offset'), '10')
    await click('Xem chi tiết'); await detail()
    await browser.command('Page.reload'); await detail()
    await click('Quay lại danh sách'); await settled()
    s = await state(); assert.equal(s.page, 'Trang 2'); assert.equal(s.draft['result-id'], '')
    await click('Trang trước'); await settled(); assert.equal((await state()).page, 'Trang 1')
  })
  await check('Desktop/tablet/mobile: 12 trường, badge, giá trị nổi bật, không tràn trang', async () => {
    await search({ 'result-id': sample.result_id }); await click('Xem chi tiết'); await detail()
    assert.equal(await evaluate(() => document.querySelector('.detail-header .status-badge').textContent), 'FINAL')
    assert.ok(await evaluate(() => parseFloat(getComputedStyle(document.querySelector('.result-value')).fontSize) >= 28))
    for (const [width, height, columns, label] of [[1440, 1000, 2, 'desktop'], [768, 1024, 1, 'tablet'], [375, 812, 1, 'mobile']]) {
      await browser.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 })
      const s = await state(); assert.equal(s.cardColumns, columns); assert.equal(s.noOverflow, true)
      assert.equal(Object.keys(s.fields).length, 12)
      await screenshot('detail-' + label)
    }
    await click('Quay lại danh sách'); await settled()
    let s = await state(); assert.equal(s.filterColumns, 1); assert.equal(s.noOverflow, true)
    assert.equal(await evaluate(() => { const n = document.querySelector('.table-wrapper'); return n.scrollWidth > n.clientWidth }), true)
    await screenshot('list-mobile')
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  })
  if (real) {
    for (const id of ['.', '..']) await check('API thật: tìm result_id ' + id + ' qua proxy đúng quy ước dot', async () => {
      const s = await search({ 'result-id': id })
      assert.equal(s.http.at(-1).headers['X-LIS-Dot-Segment'], '1')
      assert.equal(s.http.at(-1).url, '/api/lis/results/' + id.replaceAll('.', '%252E'))
      assert.equal(s.http.at(-1).status, 404); assert.equal(s.alert, null); assert.match(s.content, /Không có kết quả/)
    })
  } else {
    await check('Lỗi route/400/503/502/JSON/mạng phân biệt rỗng; thử lại giữ mã', async () => {
      const failures = [
        [{ status: 400, json: {} }, 'HTTP 400'],
        [{ status: 404, json: { error: { code: 'NOT_FOUND', message: 'API route not found' } } }, 'HTTP 404'],
        [{ status: 404, html: '<html>not found</html>' }, 'HTTP 404'],
        [{ status: 503, json: {} }, 'HTTP 503'], [{ status: 502, html: '<html>gateway</html>' }, 'HTTP 502'],
        [{ html: '<html>not JSON</html>' }, 'JSON'], [{ networkError: true }, 'Không thể kết nối'],
        [{ json: { ...sample, result_id: 'WRONG' } }, 'không khớp'],
      ]
      for (const [response, message] of failures) {
        override = () => response
        const s = await search({ 'result-id': sample.result_id })
        assert.ok(s.alert.includes(message)); assert.equal(s.rows.length, 0)
        override = undefined
        const previous = browser.requests.length
        await click('Thử tải lại'); await settled()
        assert.equal(browser.requests.length, previous + 1); assertTable(await state(), [sample])
        assert.equal(browser.requests.at(-1).query.result_id, undefined)
      }
    })
    await check('URL result_id sai/lặp không gọi HTTP, phục hồi mặc định', async () => {
      for (const hash of ['#/results?result_id=%GG', '#/results?result_id=%20', '#/results?result_id=A&result_id=B']) {
        const previous = browser.requests.length
        await evaluate((hash) => { location.hash = hash }, hash)
        await until(async () => await evaluate(() => document.querySelector('[role="alert"]')?.textContent.includes('URL không hợp lệ')), 'URL lỗi')
        assert.equal(browser.requests.length, previous)
      }
      await click('Về danh sách mặc định'); await settled()
    })
    await check('Tìm result_id: loading, abort và phản hồi muộn không ghi đè bộ lọc mới', async () => {
      await evaluate(() => {
        window.beforeHold = window.fetch; window.heldRequests = []; window.holdSearch = true
        window.fetch = async (url, options) => {
          const entry = { signal: options.signal }; window.heldRequests.push(entry)
          const hold = window.holdSearch; window.holdSearch = false
          const response = await window.beforeHold(url, { ...options, signal: undefined })
          if (hold) await new Promise((resolve) => { entry.release = resolve })
          return response
        }
      })
      await input('result-id', sample.result_id); await click('Tìm kiếm')
      await until(async () => await evaluate(() => !!window.heldRequests[0]?.release), 'giữ GET cũ')
      assert.equal((await state()).busy, 'true'); assert.equal((await state()).rows.length, 0)
      assert.match((await state()).content, /Đang tải/)
      await search({ 'result-id': 'MISSING' })
      assert.equal(await evaluate(() => window.heldRequests[0].signal.aborted), true)
      await evaluate(() => window.heldRequests[0].release()); await delay(200)
      const s = await state(); assert.equal(s.rows.length, 0); assert.match(s.content, /Không có kết quả/)
      await evaluate(() => { window.fetch = window.beforeHold })
    })
  }
  assert.ok(browser.requests.every((r) => r.method === 'GET'))
  report.completed = true
} finally {
  if (browser) {
    report.requests = browser.requests; report.exceptions = browser.exceptions; report.interceptionErrors = browser.interceptionErrors
    await browser.close()
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, 'browser-uiux.json'), JSON.stringify(report, null, 2) + '\n')
}
