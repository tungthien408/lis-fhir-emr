import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer, preview } from 'vite'

// CDP chặn HTTP trước khi tới proxy; không thay fetch hay mã ứng dụng.
export async function openHttpBrowser(onRequest, { mode = 'preview', live = false, onEvent } = {}) {
  const appRoot = path.resolve(import.meta.dirname, '../..')
  assert.ok(existsSync(path.join(appRoot, 'dist/index.html')), 'Chạy npm run build:emr trước')
  const executable = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(existsSync)
  assert.ok(executable, 'Cần Chrome/Chromium hoặc CHROME_PATH')
  const cache = path.join(appRoot, 'node_modules/.cache/emr-browser')
  mkdirSync(cache, { recursive: true })
  const profile = mkdtempSync(path.join(cache, 'profile-'))
  const requests = []
  const cancelledNetwork = new Set()
  const exceptions = []
  const interceptionErrors = []
  const pending = new Map()
  const port = live ? (mode === 'development' ? 5175 : 4175) : 5195
  const origin = 'http://127.0.0.1:' + port
  let server, browser, socket, sequence = 0, sessionId
  let closed = false
  const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('CDP timeout: ' + method))
    }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }))
  })
  async function close() {
    closed = true
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        try { await send('Browser.close', {}, null) } catch { /* Đã đóng trong cleanup. */ }
        socket.close()
      }
      if (browser && browser.exitCode === null) browser.kill()
    } finally {
      if (server) {
        server.httpServer.closeAllConnections()
        if (server.close) await server.close()
        else await new Promise((resolve) => server.httpServer.close(resolve))
      }
    }
  }
  try {
    const settings = {
      root: appRoot, configFile: path.join(appRoot, 'vite.config.ts'), logLevel: 'silent',
      cacheDir: path.join(cache, 'vite-' + mode),
      [mode === 'development' ? 'server' : 'preview']: {
        host: '127.0.0.1', port, strictPort: true, open: false,

      },
    }
    let existing = false
    if (live) { try { existing = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok } catch {} }
    if (!existing) {
      if (mode === 'development') { server = await createServer(settings); await server.listen() }
      else server = await preview(settings)
    }
    browser = spawn(executable, [
      '--headless=new', '--disable-gpu', '--disable-background-networking',
      '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let output = '', spawnError
    browser.on('error', (error) => { spawnError = error })
    browser.stderr.on('data', (data) => { output += data.toString() })
    const deadline = Date.now() + 15000
    let endpoint
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output)?.[1]
      if (endpoint) break
      if (browser.exitCode !== null) throw new Error('Chrome thoát: ' + output)
      await delay(100)
    }
    assert.ok(endpoint, 'Chrome không mở CDP: ' + output)
    socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      onEvent?.(message)
      const command = pending.get(message.id)
      if (command) {
        clearTimeout(command.timer)
        pending.delete(message.id)
        if (message.error) command.reject(new Error(JSON.stringify(message.error)))
        else command.resolve(message.result)
      }
      if (!onRequest && message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/')) {
        const { request } = message.params
        requests.push({ method: request.method, url: request.url, query: Object.fromEntries(new URL(request.url).searchParams) })
      }
      if (message.method === 'Network.loadingFailed' && (message.params.canceled || message.params.errorText === 'net::ERR_ABORTED')) cancelledNetwork.add(message.params.requestId)
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
      if (message.method === 'Fetch.requestPaused') {
        const { request, requestId, networkId } = message.params
        const entry = { method: request.method, url: request.url, query: Object.fromEntries(new URL(request.url).searchParams) }
        requests.push(entry)
        void (async () => {
          assert.equal(request.method, 'GET', 'EMR test refuses every write')
          assert.match(new URL(request.url).pathname, /^\/api\/emr\/(?:patients|lab-results)$/)
          const response = await onRequest(entry)
          if (networkId && cancelledNetwork.has(networkId)) { entry.cancelled = true; return }
          if (response.networkError) {
            await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
            entry.failed = true
            return
          }
          entry.status = response.status ?? 200
          entry.contentType = response.html === undefined ? 'application/json' : 'text/html'
          entry.body = response.html ?? response.json
          await send('Fetch.fulfillRequest', {
            requestId, responseCode: entry.status,
            responseHeaders: [{ name: 'Content-Type', value: entry.contentType }],
            body: Buffer.from(response.html ?? JSON.stringify(response.json)).toString('base64'),
          })
          entry.fulfilled = true
        })().catch((error) => {
          if (networkId && cancelledNetwork.has(networkId) && String(error).includes('Invalid InterceptionId')) entry.cancelled = true
          else if (!closed) interceptionErrors.push(String(error.stack ?? error))
        })
      }
    })
    socket.addEventListener('close', () => {
      for (const command of pending.values()) {
        clearTimeout(command.timer)
        command.reject(new Error('CDP đã đóng'))
      }
      pending.clear()
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null)
    ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null))
    await send('Runtime.enable')
    await send('Page.enable')
    if (onRequest) await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] })
    await send('Network.enable')
    await send('Network.setCacheDisabled', { cacheDisabled: true })
    const version = await send('Browser.getVersion', {}, null)
    return {
      requests, exceptions, interceptionErrors, close, version, executable,
      async evaluate(fn, argument = null) {
        const response = await send('Runtime.evaluate', {
          expression: '(' + fn.toString() + ')(' + JSON.stringify(argument) + ')',
          awaitPromise: true, returnByValue: true,
        })
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
        return response.result.value
      },
      async navigate(hash = '') { await send('Page.navigate', { url: origin + '/' + hash }) },
      command: send,
      async screenshot() { return (await send('Page.captureScreenshot', { format: 'png' })).data },
    }
  } catch (error) {
    await close()
    throw error
  }
}

export async function until(predicate, description) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(50)
  }
  throw new Error('Hết thời gian: ' + description)
}
