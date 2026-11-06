import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'

const real = process.argv.includes('--real')
const evidence = path.resolve(process.env.LIS_EVIDENCE_DIR || path.join(import.meta.dirname, 'evidence/phase-2.2-2026-11-03'))
mkdirSync(evidence, { recursive: true })
const report = {
  source: real ? 'API LIS thật qua Vite proxy, chỉ GET; không chặn HTTP' : 'HTTP mô phỏng bằng Chrome CDP; dữ liệu biên không ghi database',
  startedAt: new Date().toISOString(), completed: false, checks: [], apiCalls: [],
}
const sample = {
  result_id: ' R/AbC+%?#& tiếng Việt ', patient_id: ' P1 ', test_code: 'T1',
  test_name: 'Xét nghiệm mô phỏng', fluid: 'Blood', category: 'Chemistry',
  value_num: '12345678901234567890.123456789012345678901234567890', unit: 'mg/dL',
  reference_low: '-2.5000000000', reference_high: '0',
  effective_at: '2180-06-03T12:34:56.123456Z', result_status: 'FINAL',
}
const dataset = Array.from({ length: 31 }, (_, i) => ({ ...sample, result_id: 'R-' + i }))
let browser, respond
async function check(name, action) {
  const entry = { name }
  report.checks.push(entry)
  try {
    await action()
    assert.deepEqual(browser.exceptions, [])
    assert.deepEqual(browser.interceptionErrors, [])
    entry.result = 'PASS'
    console.log('PASS: ' + name)
  } catch (error) {
    entry.result = 'FAIL'
    entry.error = String(error.stack ?? error)
    throw error
  }
}
const evaluate = (fn, arg) => browser.evaluate(fn, arg)
async function visibleDetail(id) {
  await until(async () => await evaluate((id) =>
    document.querySelector('[data-field="result_id"]')?.textContent === id
    && document.querySelector('.detail-content')?.getAttribute('aria-busy') === 'false', id), 'chi tiết ' + id)
}
async function visibleList(page = 1) {
  await until(async () => await evaluate((page) =>
    document.querySelector('.results-content')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.results-pagination p')?.textContent === 'Trang ' + page
    && !!document.querySelector('tbody tr'), page), 'danh sách trang ' + page)
}
async function click(text) {
  await evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('Nút không khả dụng: ' + text)
    button.click()
  }, text)
}
async function hash(value) {
  await evaluate((value) => { location.hash = value }, value)
}
async function setValue(id, value) {
  await evaluate(({ id, value }) => {
    const input = document.getElementById(id)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, { id, value })
}
async function fields() {
  return evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-field]')].map((node) =>
    [node.dataset.field, node.dataset.field === 'effective_at'
      ? node.querySelector('time')?.getAttribute('datetime') ?? null : node.textContent])))
}
async function compareFields(data) {
  const expected = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key === 'effective_at' ? value : value ?? '—']))
  assert.deepEqual(await fields(), expected)
  if (data.effective_at) {
    assert.deepEqual(await evaluate(() => {
      const time = document.querySelector('time')
      return [time.textContent, time.title]
    }), [data.effective_at.slice(0, 19).replace('T', ' '), data.effective_at])
  }
}
async function screenshot(name) {
  writeFileSync(path.join(evidence, name + '.png'), Buffer.from(await browser.screenshot(), 'base64'))
}
async function api(suffix) {
  const url = 'http://127.0.0.1:3101/api/results' + suffix
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  report.apiCalls.push({ method: 'GET', url, status: response.status, body })
  assert.equal(response.status, 200)
  return body
}
function normal(request) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/lis/results') {
    return { json: { ...sample, result_id: decodeURIComponent(url.pathname.slice('/api/lis/results/'.length)) } }
  }
  const offset = Number(request.query.offset), limit = Number(request.query.limit)
  const matching = dataset.filter((row) => !request.query.test_code || row.test_code === request.query.test_code)
  return { json: { items: matching.slice(offset, offset + limit), limit, offset } }
}

try {
  respond = normal
  browser = await openHttpBrowser(real ? undefined : (request) => respond(request))
  report.browser = browser.version
  report.executable = browser.executable
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })

  if (real) {
    const first = await api('?limit=11&offset=0')
    const code = first.items[0].test_code
    const context = '?test_code=' + encodeURIComponent(code) + '&page=2'
    let current, detailHash
    await check('API thật: mở trang 2 đã lọc, gõ bản nháp, mở chi tiết và đối chiếu đủ 12 trường', async () => {
      const page = await api('?limit=11&offset=10&test_code=' + encodeURIComponent(code))
      assert.ok(page.items.length > 0, 'Cần dữ liệu trang 2 của mã xét nghiệm')
      current = page.items[0]
      await browser.navigate('#/results' + context)
      await visibleList(2)
      assert.deepEqual(await evaluate(() => [...document.querySelectorAll('tbody tr')].map((r) => r.cells[0].textContent)), page.items.slice(0, 10).map((r) => r.result_id))
      await setValue('patient-id', 'BAN-NHAP-CHUA-AP-DUNG')
      await click('Xem chi tiết')
      await visibleDetail(current.result_id)
      detailHash = await evaluate(() => location.hash)
      assert.equal(detailHash, '#/results/' + encodeURIComponent(current.result_id) + context)
      const detail = await api('/' + encodeURIComponent(current.result_id))
      await compareFields(detail)
      assert.equal(new URL(browser.requests.at(-1).url).search, '')
      await screenshot('real-detail-desktop')
      assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.result-detail-grid')).gridTemplateColumns.split(' ').length), 2)
    })
    await check('API thật: F5 chi tiết, quay lại đúng bộ lọc/trang, F5 danh sách và Back/Forward', async () => {
      await browser.command('Page.reload')
      await visibleDetail(current.result_id)
      await compareFields(current)
      await click('Quay lại danh sách')
      await visibleList(2)
      assert.equal(await evaluate(() => location.hash), '#/results' + context)
      assert.equal(await evaluate(() => document.getElementById('test-code').value), code)
      assert.equal(await evaluate(() => document.getElementById('patient-id').value), '')
      await browser.command('Page.reload')
      await visibleList(2)
      await evaluate(() => history.back())
      await visibleDetail(current.result_id)
      await evaluate(() => history.forward())
      await visibleList(2)
    })
    await check('API thật: URL trực tiếp không có ngữ cảnh, bố cục rộng/hẹp và quay về danh sách mặc định', async () => {
      await browser.navigate('#/results/' + encodeURIComponent(current.result_id))
      await visibleDetail(current.result_id)
      await browser.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
      assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.result-detail-grid')).gridTemplateColumns.split(' ').length), 1)
      assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await screenshot('real-detail-mobile')
      await click('Quay lại danh sách')
      await visibleList()
      assert.equal(await evaluate(() => location.hash), '#/results')
    })
  } else {
    await check('HTTP mô phỏng: ID đặc biệt, GET không có query, 12 trường, UTC/ISO và bố cục hai/một cột', async () => {
      await browser.navigate('#/results/' + encodeURIComponent(sample.result_id) + '?test_code=T1&page=3')
      await visibleDetail(sample.result_id)
      await compareFields(sample)
      assert.equal(new URL(browser.requests.at(-1).url).pathname, '/api/lis/results/' + encodeURIComponent(sample.result_id))
      assert.equal(new URL(browser.requests.at(-1).url).search, '')
      assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.result-detail-grid')).gridTemplateColumns.split(' ').length), 2)
      await screenshot('mock-detail-desktop')
      await browser.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
      assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.result-detail-grid')).gridTemplateColumns.split(' ').length), 1)
      assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await screenshot('mock-detail-mobile')
    })
    await check('HTTP mô phỏng: số 0, số âm, thập phân dài, cận thiếu, nullable, READY/FINAL', async () => {
      for (const [i, value_num] of ['0', '-2.50', sample.value_num].entries()) {
        const data = { ...sample, result_id: 'VALUE-' + i, value_num, fluid: null, category: null,
          reference_low: i === 0 ? null : '-0.000000001', reference_high: i === 1 ? null : '0',
          effective_at: i === 2 ? null : sample.effective_at, result_status: i === 1 ? 'READY' : 'FINAL' }
        respond = () => ({ json: data })
        await browser.navigate('#/results/' + data.result_id)
        await visibleDetail(data.result_id)
        await compareFields(data)
      }
      respond = normal
    })
    await check('HTTP mô phỏng: trang 2/3 giữ bộ lọc đã áp dụng, F5 và Back/Forward, tìm lại cùng điều kiện', async () => {
      for (const page of [2, 3]) {
        const context = '?test_code=T1&page=' + page
        await browser.navigate('#/results' + context)
        await visibleList(page)
        await setValue('patient-id', 'DRAFT')
        const id = await evaluate(() => document.querySelector('tbody tr').cells[0].textContent)
        await click('Xem chi tiết')
        await visibleDetail(id)
        await browser.command('Page.reload')
        await visibleDetail(id)
        await click('Quay lại danh sách')
        await visibleList(page)
        assert.equal(await evaluate(() => location.hash), '#/results' + context)
        assert.equal(browser.requests.at(-1).query.offset, String((page - 1) * 10))
        assert.equal(browser.requests.at(-1).query.test_code, 'T1')
        assert.equal(browser.requests.at(-1).query.patient_id, undefined)
        await browser.command('Page.reload')
        await visibleList(page)
        await evaluate(() => history.back())
        await visibleDetail(id)
        await evaluate(() => history.forward())
        await visibleList(page)
      }
      await click('Tìm kiếm')
      await visibleList(1)
      const before = browser.requests.length
      await click('Tìm kiếm')
      await until(() => browser.requests.length > before, 'tìm kiếm lại cùng URL')
      await visibleList(1)
    })
    await check('HTTP mô phỏng: 400/404/503/502 HTML, 200 HTML, mạng, thiếu trường và sai ID; thử lại cùng ID', async () => {
      const errors = [
        ['400', { status: 400, json: {} }, 'HTTP 400', false],
        ['404', { status: 404, json: {} }, 'HTTP 404', false],
        ['503', { status: 503, json: {} }, 'HTTP 503', true],
        ['502', { status: 502, html: '<html>Bad Gateway</html>' }, 'HTTP 502', true],
        ['html200', { html: '<html>bad json</html>' }, 'JSON', true],
        ['network', { networkError: true }, 'Không thể kết nối', true],
        ['structure', { json: { result_id: 'structure' } }, 'không hợp lệ', true],
        ['mismatch', { json: { ...sample, result_id: 'WRONG' } }, 'không khớp', true],
      ]
      for (const [id, response, message, retry] of errors) {
        respond = () => response
        await browser.navigate('#/results/' + id + '?page=3')
        await until(async () => await evaluate(() => !!document.querySelector('[role="alert"]')), 'lỗi ' + id)
        assert.ok(await evaluate((message) => document.querySelector('[role="alert"]').textContent.includes(message), message))
        assert.equal(await evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Thử tải lại')), retry)
        assert.equal(await evaluate(() => document.querySelectorAll('[data-field]').length), 0)
        if (retry) {
          const previous = browser.requests.length
          respond = normal
          await click('Thử tải lại')
          await visibleDetail(id)
          assert.equal(browser.requests.length, previous + 1)
          assert.equal(new URL(browser.requests.at(-1).url).pathname, '/api/lis/results/' + id)
          assert.equal(new URL(browser.requests.at(-1).url).search, '')
        } else {
          respond = normal
          await click('Quay lại danh sách')
          await visibleList(3)
        }
      }
      respond = normal
    })
    await check('HTTP mô phỏng: URL sai hiển thị lỗi và không gửi GET, kể cả ngữ cảnh chi tiết sai', async () => {
      await browser.navigate('#/results')
      await visibleList()
      for (const value of ['#/results?result_status=ACK', '#/results?patient_id=%20', '#/results?page=-1', '#/results?page=2&page=3', '#/results/%GG', '#/results/R1?test_code=%FF', '#/results/']) {
        const previous = browser.requests.length
        await hash(value)
        await until(async () => await evaluate(() => document.querySelector('[role="alert"]')?.textContent.includes('URL không hợp lệ')), value)
        assert.equal(browser.requests.length, previous)
      }
      await click('Về danh sách mặc định')
      await visibleList()
    })
    await check('HTTP mô phỏng: hủy khi đổi ID/rời trang/thử lại; phản hồi đến muộn không ghi đè', async () => {
      // Bỏ signal khỏi fetch kiểm thử để buộc phản hồi cũ vẫn đến; ghi signal thật ứng dụng đã truyền.
      await evaluate(() => {
        window.savedFetch = window.fetch
        window.tracked = []
        window.fetch = async (url, options) => {
          const entry = { url, signal: options?.signal }
          window.tracked.push(entry)
          const response = await window.savedFetch(url, { ...options, signal: undefined })
          if (window.holdNext) {
            window.holdNext = false
            await new Promise((resolve) => { entry.release = resolve })
          }
          return response
        }
      })
      for (const leave of [false, true]) {
        await evaluate(() => { window.holdNext = true })
        await hash('#/results/OLD-' + leave)
        await until(async () => await evaluate(() => !!window.tracked.at(-1)?.release), 'giữ phản hồi cũ')
        assert.equal(await evaluate(() => document.querySelector('.detail-content').getAttribute('aria-busy')), 'true')
        if (leave) {
          await click('Quay lại danh sách')
          await visibleList()
        } else {
          await hash('#/results/NEW')
          await visibleDetail('NEW')
        }
        assert.equal(await evaluate(() => window.tracked.find((r) => r.release).signal.aborted), true)
        await evaluate(() => {
          const held = window.tracked.find((r) => r.release)
          held.release()
          delete held.release
        })
        await delay(200)
        if (leave) assert.equal(await evaluate(() => !!document.querySelector('.results-content')), true)
        else await visibleDetail('NEW')
      }
      // Thử lại tạo controller mới và hủy controller của lần lỗi.
      respond = () => ({ status: 503, json: {} })
      await hash('#/results/RETRY')
      await until(async () => await evaluate(() => !!document.querySelector('[role="alert"]')), '503')
      const index = await evaluate(() => window.tracked.length - 1)
      respond = normal
      await click('Thử tải lại')
      await visibleDetail('RETRY')
      assert.equal(await evaluate((i) => window.tracked[i].signal.aborted, index), true)
      await evaluate(() => { window.fetch = window.savedFetch })
    })
  }
  assert.ok(browser.requests.every((r) => r.method === 'GET'))
  report.completed = true
} finally {
  if (browser) {
    report.requests = browser.requests
    report.exceptions = browser.exceptions
    report.interceptionErrors = browser.interceptionErrors
    await browser.close()
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, real ? 'detail-real-browser.json' : 'detail-http-browser.json'), JSON.stringify(report, null, 2) + '\n')
}
