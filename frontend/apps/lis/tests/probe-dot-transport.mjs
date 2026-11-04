import assert from 'node:assert/strict'
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createServer, preview } from 'vite'
import { withDotResultProxy } from '../proxy/lis.ts'
import { lisResultRequest, DOT_SEGMENT_HEADER } from '../src/api/resultRequest.ts'

const evidence = path.join(import.meta.dirname, 'evidence/phase-2.2-dot-fix-2026-11-03')
const report = { source: 'Mã hiện tại: native HTTP qua Vite dev/preview thật đến upstream mô phỏng chỉ echo, không database', cases: [], completed: false }
const upstream = http.createServer((req, res) => {
  const rawPath = req.url.split('?')[0]
  const id = rawPath.startsWith('/api/results/') ? decodeURIComponent(rawPath.slice('/api/results/'.length)) : null
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Vary', 'Accept-Encoding')
  res.end(JSON.stringify({ rawPath: req.url, id, marker: req.headers[DOT_SEGMENT_HEADER.toLowerCase()] ?? null, method: req.method }))
})
let app
try {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const target = 'http://127.0.0.1:' + upstream.address().port
  const ids = ['.', '..', '%2E', '%2E%2E', '%2e', '%2e%2e', '%252E', '%', '%25', 'R1', 'a/b', 'a%2Fb', '+', '#', '?', ' Kết quả/AbC+%?# 🧪 ']
  for (const mode of ['development', 'preview']) {
    const proxy = {
      '/api/lis': withDotResultProxy({ target, changeOrigin: true, rewrite: (url) => url.replace(/^\/api\/lis/, '/api') }),
      '/api/middleware': { target, rewrite: (url) => url.replace(/^\/api\/middleware/, '/middleware') },
      '/api/emr': { target, rewrite: (url) => url.replace(/^\/api\/emr/, '/emr') },
    }
    const common = { root: path.resolve(import.meta.dirname, '..'), configFile: false, logLevel: 'silent' }
    if (mode === 'development') {
      app = await createServer({ ...common, cacheDir: 'node_modules/.cache/dot-preflight', server: { host: '127.0.0.1', port: 5196, strictPort: true, proxy } })
      await app.listen()
    } else app = await preview({ ...common, preview: { host: '127.0.0.1', port: 5197, strictPort: true, proxy } })
    const origin = 'http://127.0.0.1:' + app.httpServer.address().port
    for (const id of ids) {
      const request = lisResultRequest(id)
      const response = await fetch(origin + request.path, { headers: request.headers })
      const body = await response.json()
      assert.equal(response.status, 200)
      assert.equal(body.id, id)
      assert.equal(body.marker, null)
      assert.equal(body.method, 'GET')
      const dot = id === '.' || id === '..'
      assert.equal(body.rawPath, '/api/results/' + (dot ? id.replaceAll('.', '%2E') : encodeURIComponent(id)))
      const alias = dot || ['%2E', '%2E%2E', '%2e', '%2e%2e'].includes(id)
      assert.equal(response.headers.get('vary').toLowerCase().includes(DOT_SEGMENT_HEADER.toLowerCase()), alias)
      assert.ok(response.headers.get('vary').includes('Accept-Encoding'))
      report.cases.push({ mode, id, request, status: response.status, body, vary: response.headers.get('vary'), result: 'PASS' })
    }
    for (const url of ['/api/lis/results?limit=11&offset=20&patient_id=P1', '/api/lis/results/R1/publish', '/api/lis/ready', '/api/middleware/results/%252E', '/api/emr/results/%252E']) {
      const response = await fetch(origin + url, { headers: { [DOT_SEGMENT_HEADER]: '1' } })
      const body = await response.json()
      const expected = url.replace(/^\/api\/lis/, '/api').replace(/^\/api\/middleware/, '/middleware').replace(/^\/api\/emr/, '/emr')
      assert.equal(body.rawPath, expected)
      if (url.startsWith('/api/lis')) assert.equal(body.marker, null)
      assert.equal(response.headers.get('vary'), 'Accept-Encoding')
      report.cases.push({ mode, url, body, result: 'PASS', note: 'GET only, including path named publish; no POST' })
    }
    if (mode === 'development') await app.close()
    else { app.httpServer.closeAllConnections(); await new Promise((resolve) => app.httpServer.close(resolve)) }
    app = null
  }
  report.completed = true
  console.log('PASS: ' + report.cases.length + ' transport/endpoint checks, Vite dev + preview; no ID collisions')
} finally {
  if (app?.close) await app.close()
  else if (app) { app.httpServer.closeAllConnections(); await new Promise((resolve) => app.httpServer.close(resolve)) }
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  writeFileSync(path.join(evidence, 'proxy-http.json'), JSON.stringify(report, null, 2) + '\n')
}
