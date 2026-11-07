import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { getLisResult, LisApiError } from '../src/api/lis.ts'
import { parseResultsHash, resultsHash } from '../src/state/routes.ts'
import { initialQuery } from '../src/state/results.ts'

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    }
    return nextLoad(url, context)
  },
})
const { ResultDetailFields } = await import('../src/components/ResultDetail.tsx')

const sample = {
  result_id: ' R/AbC+%?#& tiếng Việt ', patient_id: ' P1 ', test_code: 'T1',
  test_name: 'Xét nghiệm', fluid: null, category: null,
  value_num: '12345678901234567890.123456789012345678901234567890', unit: 'mg/dL',
  reference_low: '-2.5000000000', reference_high: '0',
  effective_at: '2180-06-03T12:34:56.123456Z', result_status: 'FINAL',
}

test('Route: ID mã hóa một lần, giữ nguyên hoa/thường, khoảng trắng, Unicode và ký tự đặc biệt', () => {
  for (const id of [sample.result_id, '.', '..', '%2E', '%2E%2E', '%2F', '0', 'a/b', 'a?b#c', ' AbC ', '🧪']) {
    const hash = resultsHash(initialQuery, id)
    assert.equal(hash, '#/results/' + encodeURIComponent(id))
    assert.equal(parseResultsHash(hash).resultId, id)
  }
})

test('Route: khôi phục đủ bộ lọc áp dụng, trang 2/3, không lấy bản nháp', () => {
  for (const pageIndex of [0, 1, 2]) {
    const query = { filters: { patientId: 'P+&?', resultId: '', testCode: 't/Code', resultStatus: 'READY' }, pageIndex }
    for (const id of [undefined, sample.result_id]) assert.deepEqual(parseResultsHash(resultsHash(query, id)).query, query)
  }
  assert.deepEqual(parseResultsHash('').query, initialQuery)
  assert.deepEqual(parseResultsHash('#/results/R1').query, initialQuery)
})

test('Route: từ chối URL sai thay vì mở rộng danh sách; không sửa định danh', () => {
  const invalid = [
    '#/other', '#/results/', '#/results/a/b', '#/results/%', '#/results/%FF',
    '#/results/%20', '#/results/%00',
    '#/results?page=0', '#/results?page=-1', '#/results?page=1.5', '#/results?page=1e2',
    '#/results?page=9007199254740991', '#/results?page=2&page=3',
    '#/results?patient_id=', '#/results?test_code=%20', '#/results?patient_id=%0A',
    '#/results?patient_id=%GG', '#/results?patient_id=%FF', '#/results?result_status=ACK',
    '#/results?result_status=', '#/results?offset=20', '#/results?test_code',
    '#/results/R1?result_status=invalid', '#/results?patient_id=A&patient_id=B',
  ]
  for (const hash of invalid) assert.equal(parseResultsHash(hash).kind, 'invalid', hash)
})

test('GET chi tiết: đúng ID, đúng signal, không truyền ngữ cảnh danh sách', async (t) => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/lis/results/' + encodeURIComponent(sample.result_id))
    assert.equal(options.signal, controller.signal)
    assert.equal(new URL(path, 'http://localhost').search, '')
    return Response.json(sample)
  })
  assert.deepEqual(await getLisResult(sample.result_id, controller.signal), sample)
})

test('GET chi tiết: kiểm tra sự hiện diện và kiểu của từng trường trong 12 trường', async (t) => {
  const invalid = [[], [sample], null, { items: [sample] }, { ...sample, result_id: 'WRONG' }, { ...sample, result_status: 'ACK' }]
  for (const key of Object.keys(sample)) {
    const missing = { ...sample }
    delete missing[key]
    invalid.push(missing, { ...sample, [key]: 123 })
    if (!['fluid', 'category', 'reference_low', 'reference_high', 'effective_at'].includes(key)) invalid.push({ ...sample, [key]: null })
  }
  for (const payload of invalid) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(payload))
    await assert.rejects(getLisResult(sample.result_id), /không hợp lệ|không khớp/)
    t.mock.restoreAll()
  }
})

test('GET chi tiết: nullable, READY/FINAL và số giữ nguyên chuỗi', async (t) => {
  for (const value_num of ['0', '-2.50', sample.value_num]) {
    for (const result_status of ['READY', 'FINAL']) {
      const data = { ...sample, value_num, result_status, reference_low: null, reference_high: null, effective_at: null }
      t.mock.method(globalThis, 'fetch', async () => Response.json(data))
      assert.deepEqual(await getLisResult(sample.result_id), data)
      t.mock.restoreAll()
    }
  }
})

for (const status of [400, 404, 503, 502]) {
  test('GET chi tiết: HTTP ' + status + ' có thông báo và mã HTTP', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => status === 502
      ? new Response('<html>Bad Gateway</html>', { status })
      : Response.json({ error: { code: 'ERROR', message: 'backend' } }, { status }))
    await assert.rejects(getLisResult(sample.result_id), (error) =>
      error instanceof LisApiError && error.status === status && error.message.includes('HTTP ' + status)
      && !error.message.includes('<html>') && !error.message.includes('backend'))
  })
}

test('GET chi tiết: JSON lỗi, mạng lỗi, ID sai và hủy yêu cầu', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>200</html>'))
  await assert.rejects(getLisResult(sample.result_id), /JSON/)
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(getLisResult(sample.result_id), /Không thể kết nối/)
  t.mock.restoreAll()
  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => signal.throwIfAborted())
  await assert.rejects(getLisResult(sample.result_id, controller.signal), { name: 'AbortError' })
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', () => assert.fail('ID sai không được gửi GET'))
  for (const id of ['', ' ', '\u0000']) await assert.rejects(getLisResult(id), (error) => error.status === 400)
})

test('Chi tiết: đủ 12 trường, số 0/âm/dài, cận riêng, null, UTC và ISO gốc', () => {
  for (const value_num of ['0', '-2.50', sample.value_num]) {
    const html = renderToStaticMarkup(createElement(ResultDetailFields, { result: { ...sample, value_num } }))
    assert.equal((html.match(/data-field=/g) || []).length, 12)
    for (const key of Object.keys(sample)) assert.ok(html.includes('data-field="' + key + '"'))
    for (const value of [value_num, '-2.5000000000', '>0<', 'mg/dL', '2180-06-03 12:34:56', sample.effective_at, 'FINAL']) assert.ok(html.includes(value), value)
    assert.equal((html.match(/>—</g) || []).length, 2)
    assert.ok(html.includes('dateTime="' + sample.effective_at + '"'))
    assert.ok(html.includes('title="' + sample.effective_at + '"'))
  }
  const html = renderToStaticMarkup(createElement(ResultDetailFields, { result: {
    ...sample, reference_low: null, reference_high: null, effective_at: null, result_status: 'READY',
  } }))
  assert.equal((html.match(/>—</g) || []).length, 5)
  assert.ok(html.includes('READY'))
})
