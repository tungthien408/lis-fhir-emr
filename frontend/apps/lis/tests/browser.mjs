import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const chromePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].find(existsSync)
if (!chromePath) throw new Error('Cần Chrome/Chromium hoặc đặt CHROME_PATH để chạy kiểm thử trình duyệt.')

const appRoot = path.resolve(import.meta.dirname, '..')
const cacheRoot = path.join(appRoot, 'node_modules/.cache/lis-browser')
mkdirSync(cacheRoot, { recursive: true })
const profile = mkdtempSync(path.join(cacheRoot, 'profile-'))
const browserErrors = []
const requests = []
const backendCalls = []
const checks = []
const evidenceDirectory = process.env.LIS_EVIDENCE_DIR
const startedAt = new Date().toISOString()
let completed = false
if (evidenceDirectory) mkdirSync(evidenceDirectory, { recursive: true })

function passed(description) {
  checks.push({ description, result: 'PASS', at: new Date().toISOString() })
  console.log('PASS: ' + description)
}
let browser
let socket
let server
let send
let sessionId

async function backend(filters = {}, pageIndex = 0) {
  const params = new URLSearchParams({ limit: '11', offset: String(pageIndex * 10), ...filters })
  const response = await fetch('http://127.0.0.1:3101/api/results?' + params, { signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  backendCalls.push({ source: 'API LIS thật, chỉ GET', at: new Date().toISOString(), query: Object.fromEntries(params), status: response.status, body })
  assert.equal(response.status, 200, 'API LIS thật phải truy cập được')
  return body
}

async function evaluate(fn, argument = null) {
  const response = await send('Runtime.evaluate', {
    expression: '(' + fn.toString() + ')(' + JSON.stringify(argument) + ')',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result.value
}

async function waitFor(fn, argument = null) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluate(fn, argument)) return
    await delay(100)
  }
  throw new Error('Hết thời gian chờ giao diện: ' + fn.toString())
}

async function setValue(selector, value) {
  await evaluate(({ selector, value }) => {
    const input = document.querySelector(selector)
    const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }, { selector, value })
}

async function clickText(text) {
  await evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('Nút không khả dụng: ' + text)
    button.click()
  }, text)
}

async function settledAfter(action) {
  const previous = requests.length
  await action()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (requests.length > previous && await evaluate(() => document.querySelector('.results-content')?.getAttribute('aria-busy') === 'false')) return
    await delay(100)
  }
  throw new Error('Không nhận được kết quả sau thao tác.')
}

async function visibleIds() {
  return evaluate(() => [...document.querySelectorAll('tbody tr')].map((row) => row.cells[0].textContent))
}

try {
  const firstPage = await backend()
  assert.ok(firstPage.items.length === 11, 'Cần ít nhất 11 kết quả thật để kiểm thử phân trang')
  const sample = firstPage.items[0]
  let existing
  try { existing = await fetch('http://127.0.0.1:5173/src/App.tsx', { signal: AbortSignal.timeout(2000) }) } catch {}
  if (existing?.ok) {
    const source = await existing.text()
    assert.ok(source.includes('ResultsPagination') && source.includes('initialQuery'), 'Cổng 5173 phải phục vụ đúng ứng dụng LIS hiện tại')
    console.log('Sử dụng máy chủ LIS đang chạy trên cổng 5173')
  } else {
    server = await createServer({ root: appRoot, configFile: path.join(appRoot, 'vite.config.ts'), logLevel: 'silent' })
    await server.listen()
  }
  browser = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let output = ''
  browser.stderr.on('data', (data) => { output += data.toString() })
  const deadline = Date.now() + 15000
  let endpoint
  while (Date.now() < deadline) {
    endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output)?.[1]
    if (endpoint) break
    if (browser.exitCode !== null) throw new Error('Không khởi động được Chrome: ' + output)
    await delay(100)
  }
  if (!endpoint) throw new Error('Chrome không mở kết nối kiểm thử: ' + output)
  socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const command = pending.get(message.id)
    if (command) {
      clearTimeout(command.timer)
      pending.delete(message.id)
      if (message.error) command.reject(new Error(JSON.stringify(message.error)))
      else command.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails)
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/lis/results?')) requests.push(message.params.request.url)
  })
  socket.addEventListener('close', () => {
    for (const command of pending.values()) {
      clearTimeout(command.timer)
      command.reject(new Error('Kết nối trình duyệt đã đóng'))
    }
    pending.clear()
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  await send('Runtime.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' }, sessionId)
  await waitFor(() => document.querySelectorAll('tbody tr').length === 10 && document.querySelector('.results-content').getAttribute('aria-busy') === 'false')
  assert.deepEqual(await visibleIds(), firstPage.items.slice(0, 10).map((row) => row.result_id))
  assert.equal(await evaluate(() => document.querySelectorAll('thead th').length), 9)
  assert.equal(await evaluate(() => [...document.querySelectorAll('tbody button')].every((button) => !button.disabled)), true)
  assert.equal(await evaluate(() => document.querySelector('time')?.getAttribute('datetime')), sample.effective_at)
  assert.equal(await evaluate(() => document.querySelector('time')?.textContent), sample.effective_at.slice(0, 19).replace('T', ' '))
  passed('danh sách thật, 10 dòng, chín cột, thời gian UTC và nút chi tiết khả dụng')

  const beforeTyping = requests.length
  await setValue('#test-code', sample.test_code)
  await delay(300)
  assert.equal(requests.length, beforeTyping)
  await evaluate(() => document.querySelector('#test-code').focus())
  await settledAfter(async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  })
  const filtered = await backend({ test_code: sample.test_code })
  assert.deepEqual(await visibleIds(), filtered.items.slice(0, 10).map((row) => row.result_id))

  await setValue('#patient-id', sample.patient_id)
  await settledAfter(() => clickText('Trang sau'))
  const pageQuery = new URL(requests.at(-1)).searchParams
  assert.equal(pageQuery.get('test_code'), sample.test_code)
  assert.equal(pageQuery.has('patient_id'), false)
  assert.equal(pageQuery.get('offset'), '10')
  assert.deepEqual(await visibleIds(), (await backend({ test_code: sample.test_code }, 1)).items.slice(0, 10).map((row) => row.result_id))
  await settledAfter(() => clickText('Trang trước'))
  assert.equal(new URL(requests.at(-1)).searchParams.get('offset'), '0')
  await settledAfter(() => clickText('Trang sau'))
  await setValue('#result-status', sample.result_status)
  await settledAfter(() => clickText('Tìm kiếm'))
  assert.equal(new URL(requests.at(-1)).searchParams.get('offset'), '0')
  const combined = await backend({ patient_id: sample.patient_id, test_code: sample.test_code, result_status: sample.result_status })
  assert.deepEqual(await visibleIds(), combined.items.slice(0, 10).map((row) => row.result_id))
  passed('không gọi khi gõ, Enter tìm kiếm, lọc kết hợp và phân trang giữ bộ lọc đã áp dụng')

  await settledAfter(() => clickText('Xóa bộ lọc'))
  assert.equal(await evaluate(() => [document.querySelector('#patient-id').value, document.querySelector('#test-code').value, document.querySelector('#result-status').value].join('')), '')
  assert.deepEqual([...new URL(requests.at(-1)).searchParams.keys()], ['limit', 'offset'])
  await setValue('#patient-id', 'LIS-UI-NO-MATCH-' + crypto.randomUUID())
  await settledAfter(() => clickText('Tìm kiếm'))
  assert.equal(await visibleIds().then((rows) => rows.length), 0)
  assert.equal(await evaluate(() => document.querySelector('.results-content').textContent.includes('Không có kết quả')), true)
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
  await clickText('Tìm kiếm')
  await waitFor(() => !!document.querySelector('[role="alert"]'))
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
  await settledAfter(() => clickText('Thử tải lại'))
  assert.equal(await evaluate(() => !!document.querySelector('[role="alert"]')), false)
  passed('xóa bộ lọc, danh sách rỗng, mất kết nối và thử tải lại')

  // Chỉ trì hoãn phản hồi thật trong trình duyệt kiểm thử, không thay dữ liệu.
  await evaluate(() => {
    window.originalLisFetch = window.fetch
    window.holdNextLisResponse = true
    window.fetch = async (url, options) => {
      const hold = window.holdNextLisResponse && String(url).startsWith('/api/lis/results?')
      if (hold) window.holdNextLisResponse = false
      const response = await window.originalLisFetch(url, { ...options, signal: undefined })
      if (hold) await new Promise((resolve) => { window.releaseOldLisResponse = resolve })
      return response
    }
  })
  await setValue('#patient-id', '')
  await setValue('#test-code', sample.test_code)
  await clickText('Tìm kiếm')
  await waitFor(() => typeof window.releaseOldLisResponse === 'function')
  await setValue('#test-code', '')
  await setValue('#patient-id', sample.patient_id)
  await settledAfter(() => clickText('Tìm kiếm'))
  const latestIds = (await backend({ patient_id: sample.patient_id })).items.slice(0, 10).map((row) => row.result_id)
  assert.deepEqual(await visibleIds(), latestIds)
  await evaluate(() => { window.releaseOldLisResponse(); window.fetch = window.originalLisFetch })
  await delay(300)
  assert.deepEqual(await visibleIds(), latestIds)
  passed('phản hồi cũ đến sau không ghi đè kết quả mới')

  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }, sessionId)
  await delay(200)
  assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  assert.equal(await evaluate(() => { const table = document.querySelector('.table-wrapper'); return table.scrollWidth > table.clientWidth }), true)
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const screenshotPath = path.join(evidenceDirectory || cacheRoot, 'lis-mobile.png')
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(browserErrors, [])
  passed('màn hình 375px, bảng cuộn ngang và không có lỗi JavaScript chưa xử lý')
  console.log('Ảnh kiểm tra: ' + screenshotPath)
  completed = true
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close') } catch {}
    socket.close()
  } else if (browser && browser.exitCode === null) {
    browser.kill()
  }
  if (server) await server.close()
  if (evidenceDirectory) writeFileSync(path.join(evidenceDirectory, 'real-browser.json'), JSON.stringify({
    source: 'API LIS thật qua Vite proxy; ngoại tuyến/trì hoãn phản hồi chỉ trong trình duyệt kiểm thử',
    startedAt, finishedAt: new Date().toISOString(), completed, checks, backendCalls, requests, browserErrors,
  }, null, 2) + '\n')
}
