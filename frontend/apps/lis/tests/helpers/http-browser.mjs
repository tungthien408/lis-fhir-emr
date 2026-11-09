import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer, preview } from 'vite'

// CDP chặn HTTP trước khi tới proxy; không thay fetch hay mã ứng dụng.
export async function openHttpBrowser(onRequest, { mode = 'preview', app = 'lis', reuseServer = false, lisTarget, middlewareTarget, publishRequests = false, flowRequests = false, onEvent } = {}) {
  const index = ['lis', 'middleware-monitor', 'emr'].indexOf(app)
  assert.ok(index >= 0, 'Unknown frontend entry point')
  const appRoot = path.resolve(import.meta.dirname, '../../..', app)
  const port = (mode === 'development' ? 5173 : 4173) + index
  const origin = 'http://127.0.0.1:' + port
  assert.ok(existsSync(path.join(appRoot, 'dist/index.html')), 'Chạy npm run build:lis trước')
  const executable = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  ].find(existsSync)
  assert.ok(executable, 'Cần Chrome/Chromium hoặc CHROME_PATH')
  const cache = path.join(appRoot, 'node_modules/.cache/lis-http-browser')
  mkdirSync(cache, { recursive: true })
  const profile = mkdtempSync(path.join(cache, 'profile-'))
  const requests = []
  const auxiliaryRequests = []
  const legacySourceStatuses = new Map()
  const exceptions = []
  const interceptionErrors = []
  const cancelledNetwork = new Set()
  const pending = new Map()
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
        ...((lisTarget || middlewareTarget) ? { proxy: { ...(lisTarget ? { '/api/lis': { target: lisTarget } } : {}), ...(middlewareTarget ? { '/api/middleware': { target: middlewareTarget } } : {}) } } : {}),
      },
    }
    if (reuseServer) {
      assert.equal(mode, 'development', 'Only reuse a verifiable development server')
      const response = await fetch(origin + '/src/App.tsx', { signal: AbortSignal.timeout(5000) })
      const source = await response.text()
      assert.ok(response.ok && source.includes(app === 'lis' ? 'readFlowRoute' : 'lis/src/App.tsx'), 'Existing server must serve this Flow Console entry point')
    } else if (mode === 'development') {
      server = await createServer(settings)
      await server.listen()
    } else server = await preview(settings)
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
      if (!onRequest && message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname.startsWith('/api/')) {
        const { request } = message.params
        const apiPath = new URL(request.url).pathname
        const target = !publishRequests && (apiPath.endsWith('/publish-event') || apiPath.startsWith('/api/middleware/')) ? auxiliaryRequests : requests
        target.push({ method: request.method, url: request.url, query: Object.fromEntries(new URL(request.url).searchParams) })
      }
      if (message.method === 'Network.loadingFailed' && (message.params.canceled || message.params.errorText === 'net::ERR_ABORTED')) cancelledNetwork.add(message.params.requestId)
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
      if (message.method === 'Fetch.requestPaused') {
        const { request, requestId, networkId } = message.params
        const entry = { method: request.method, url: request.url, query: Object.fromEntries(new URL(request.url).searchParams) }
        const auxiliary = !publishRequests && new URL(request.url).pathname.endsWith('/publish-event')
        ;(auxiliary ? auxiliaryRequests : requests).push(entry)
        void (async () => {
          assert.ok(request.method === 'GET' || (publishRequests && request.method === 'POST' && new URL(request.url).pathname.endsWith('/publish')), 'Unexpected write in browser test')
          assert.match(new URL(request.url).pathname, flowRequests
            ? /^\/api\/(?:lis\/results(?:\/[^/]+(?:\/(?:publish|publish-event))?)?|middleware\/exchanges(?:\/[^/]+(?:\/attempts)?)?|emr\/(?:patients|lab-results))$/
            : /^\/api\/(?:lis\/results(?:\/[^/]+(?:\/(?:publish|publish-event))?)?|middleware\/exchanges\/[^/]+)$/)
          // Legacy suites keep their original request oracle; this is an explicitly mocked auxiliary lookup.
          const response = auxiliary ? { json: { result_id: decodeURIComponent(new URL(request.url).pathname.slice('/api/lis/results/'.length, -'/publish-event'.length)), result_status: legacySourceStatuses.get(decodeURIComponent(new URL(request.url).pathname.slice('/api/lis/results/'.length, -'/publish-event'.length))) ?? 'FINAL', published: false, event: null } } : await onRequest(entry)
          if (!auxiliary && !publishRequests && response.json?.result_id && response.json?.result_status) legacySourceStatuses.set(response.json.result_id, response.json.result_status)
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
    if (onRequest) await send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/*', requestStage: 'Request' }] })
    await send('Network.enable')
    await send('Network.setCacheDisabled', { cacheDisabled: true })
    const version = await send('Browser.getVersion', {}, null)
    return {
      requests, auxiliaryRequests, exceptions, interceptionErrors, close, version, executable, origin,
      async evaluate(fn, argument = null) {
        const response = await send('Runtime.evaluate', {
          expression: '(' + fn.toString() + ')(' + JSON.stringify(argument) + ')',
          awaitPromise: true, returnByValue: true,
        })
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
        return response.result.value
      },
      async navigate(hash = '#/flow') { await send('Page.navigate', { url: origin + '/' + hash }) },
      async navigatePath(pathname) { await send('Page.navigate', { url: origin + pathname }) },
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
