import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLisResult, LisApiError } from '../src/api/lis.ts'

const sample = {
  result_id: ' R/AbC+%?#& tiếng Việt ', patient_id: ' P1 ', test_code: 'T1',
  test_name: 'Xét nghiệm', fluid: null, category: null,
  value_num: '12345678901234567890.123456789012345678901234567890', unit: 'mg/dL',
  reference_low: '-2.5000000000', reference_high: '0',
  effective_at: '2180-06-03T12:34:56.123456Z', result_status: 'FINAL',
}

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
