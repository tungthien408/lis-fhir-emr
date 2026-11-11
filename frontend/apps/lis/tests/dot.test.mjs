import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lisResultRequest, DOT_SEGMENT_HEADER } from '../src/api/resultRequest.ts'
import { getLisResult } from '../src/api/lis.ts'
import { withDotResultProxy } from '../proxy/lis.ts'
import lisConfig from '../vite.config.ts'
import { createFrontendConfig } from '../../../config/vite.ts'

const fixture = (id) => ({
  result_id: id, patient_id: 'P1', test_code: 'T1', test_name: 'Dot test',
  fluid: null, category: null, value_num: '0', unit: 'mg/dL',
  reference_low: null, reference_high: '1.0000', effective_at: null, result_status: 'FINAL',
})

test('Dot ID: wire path phân biệt dấu chấm và literal percent bằng marker', () => {
  const dot = lisResultRequest('.'), literal = lisResultRequest('%2E')
  assert.equal(dot.path, literal.path)
  assert.deepEqual(dot.headers, { [DOT_SEGMENT_HEADER]: '1' })
  assert.equal(literal.headers, undefined)
  assert.equal(lisResultRequest('..').path, '/api/lis/results/%252E%252E')
  for (const id of ['R1', '%2E', '%2E%2E', '%2e', '%', 'a/b', '+', '#', '?', ' tiếng Việt ']) {
    assert.deepEqual(lisResultRequest(id), { path: '/api/lis/results/' + encodeURIComponent(id) })
  }
})

test('Dot ID: GET dùng đúng path/header/signal và không nhận nhầm response literal', async (t) => {
  for (const id of ['.', '..', '%2E', '%2E%2E']) {
    const controller = new AbortController()
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const expected = lisResultRequest(id)
      assert.equal(url, expected.path)
      assert.deepEqual(options.headers, expected.headers)
      assert.equal(options.signal, controller.signal)
      return Response.json(fixture(id))
    })
    assert.deepEqual(await getLisResult(id, controller.signal), fixture(id))
    t.mock.restoreAll()
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(fixture('%2E')))
  await assert.rejects(getLisResult('.'), /không khớp/)
})

test('Dot ID: proxy chỉ đổi đúng GET có marker, không giải mã thêm ID khác hoặc endpoint khác', () => {
  const base = { target: 'http://127.0.0.1:3101', rewrite: (s) => s }
  const proxy = withDotResultProxy(base)
  assert.equal(base.toProxy, undefined)
  assert.equal(proxy.toProxy, true)
  for (const [url, marker, method, expected] of [
    ['/api/lis/results/%252E', '1', 'GET', '/api/lis/results/%2E'],
    ['/api/lis/results/%252E%252E', '1', 'GET', '/api/lis/results/%2E%2E'],
    ['/api/lis/results/%252e', '1', 'GET', '/api/lis/results/%2e'],
    ['/api/lis/results/%252E?x=1', '1', 'GET', '/api/lis/results/%2E?x=1'],
    ['/api/lis/results/%252E', undefined, 'GET', '/api/lis/results/%252E'],
    ['/api/lis/results/%252E', '0', 'GET', '/api/lis/results/%252E'],
    ['/api/lis/results/%252E', '1', 'POST', '/api/lis/results/%252E'],
    ['/api/lis/results/%252E/publish', '1', 'GET', '/api/lis/results/%252E/publish'],
    ['/api/lis/results?limit=11', '1', 'GET', '/api/lis/results?limit=11'],
    ['/api/lis/results/a%2Fb', '1', 'GET', '/api/lis/results/a%2Fb'],
  ]) {
    const request = { url, method, headers: { [DOT_SEGMENT_HEADER.toLowerCase()]: marker } }
    proxy.bypass(request, {}, proxy)
    assert.equal(request.url, expected)
    assert.equal(request.headers[DOT_SEGMENT_HEADER.toLowerCase()], undefined)
  }
})

test('Dot ID: Vary bảo vệ cache cho cả dot và literal, giữ Vary hiện có', () => {
  const proxy = withDotResultProxy({})
  const handlers = {}
  proxy.configure({ on: (name, handler) => { handlers[name] = handler } }, proxy)
  for (const marker of [undefined, '1']) {
    const request = { method: 'GET', url: '/api/lis/results/%252E', headers: { 'x-lis-dot-segment': marker } }
    proxy.bypass(request, {}, proxy)
    for (const value of [undefined, 'Accept-Encoding', '*', DOT_SEGMENT_HEADER.toLowerCase()]) {
      const response = { headers: { vary: value } }
      handlers.proxyRes(response, request)
      if (value === '*' || value === DOT_SEGMENT_HEADER.toLowerCase()) assert.equal(response.headers.vary, value)
      else assert.ok(response.headers.vary.includes(DOT_SEGMENT_HEADER))
      if (value === 'Accept-Encoding') assert.ok(response.headers.vary.includes('Accept-Encoding'))
    }
  }
  const ordinary = { method: 'GET', url: '/api/lis/results/R1', headers: {} }
  proxy.bypass(ordinary, {}, proxy)
  const response = { headers: {} }
  handlers.proxyRes(response, ordinary)
  assert.equal(response.headers.vary, undefined)
})

test('Dot ID: cả ba entry point dùng proxy LIS bảo toàn định danh cho dev/preview', () => {
  const base = createFrontendConfig(5173, 4173)
  for (const mode of ['server', 'preview']) {
    assert.equal(lisConfig[mode].proxy['/api/lis'].toProxy, true)
    for (const route of ['/api/middleware', '/api/emr']) {
      assert.deepEqual(lisConfig[mode].proxy[route], base[mode].proxy[route])
    }
    assert.equal(base[mode].proxy['/api/lis'].toProxy, true)
    assert.equal(typeof base[mode].proxy['/api/lis'].bypass, 'function')
  }
})
