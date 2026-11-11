import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLisResults, LisApiError } from '../src/api/lis.ts'
import { initialQuery, resultsPage, resultsQueryReducer } from '../src/state/results.ts'

// Phản hồi kiểm soát chỉ dùng cho unit test; ứng dụng luôn gọi API LIS thật.
function result(overrides = {}) {
  return {
    result_id: 'TEST-R1', patient_id: 'TEST-P1', test_code: 'TEST-T1',
    test_name: 'Xét nghiệm kiểm thử', fluid: null, category: null,
    value_num: '12345678901234567890.123456789', unit: 'mg/dL',
    reference_low: null, reference_high: null,
    effective_at: '2180-06-03T12:34:56.123456Z', result_status: 'FINAL',
    ...overrides,
  }
}

function mockFetch(t, handler) {
  t.mock.method(globalThis, 'fetch', handler)
}

test('API: lấy dư một dòng và trim bộ lọc, giữ nguyên hoa/thường và ký tự bên trong', async (t) => {
  const controller = new AbortController()
  mockFetch(t, async (url, options) => {
    const query = new URL(url, 'http://localhost').searchParams
    assert.equal(query.get('limit'), '11')
    assert.equal(query.get('offset'), '20')
    assert.equal(query.get('patient_id'), 'AbC+&')
    assert.equal(query.get('test_code'), 'tCode')
    assert.equal(query.get('result_status'), 'READY')
    assert.equal(options.signal, controller.signal)
    return Response.json({ items: [], limit: 11, offset: 20 })
  })
  await getLisResults({ offset: 20, patientId: '  AbC+&  ', testCode: ' tCode ', resultStatus: 'READY', signal: controller.signal })
})

test('API: bỏ ô trống và chỉ có khoảng trắng khỏi bộ lọc', async (t) => {
  mockFetch(t, async (url) => {
    const query = new URL(url, 'http://localhost').searchParams
    assert.deepEqual([...query.keys()], ['limit', 'offset'])
    return Response.json({ items: [], limit: 11, offset: 0 })
  })
  await getLisResults({ patientId: ' \t ', testCode: '' })
})

test('API: bảo toàn số, đơn vị, thời gian gốc và các giá trị null', async (t) => {
  const original = result()
  mockFetch(t, async () => Response.json({ items: [original, result({ effective_at: null })], limit: 11, offset: 0 }))
  const response = await getLisResults()
  assert.deepEqual(response.items[0], original)
  assert.equal(response.items[1].effective_at, null)
})

test('API: lỗi JSON giữ mã HTTP và mã lỗi, thông báo dễ hiểu', async (t) => {
  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [503, 'DEPENDENCY_UNAVAILABLE']]) {
    mockFetch(t, async () => Response.json({ error: { code, message: 'Thông báo backend' } }, { status }))
    await assert.rejects(getLisResults(), (error) => error instanceof LisApiError && error.status === status && error.code === code && error.message.includes('HTTP ' + status))
    t.mock.restoreAll()
  }
})

test('API: lỗi HTTP không phải JSON vẫn được xử lý đúng', async (t) => {
  mockFetch(t, async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
  await assert.rejects(getLisResults(), (error) => error instanceof LisApiError && error.status === 502 && !error.message.includes('<html>'))
})

test('API: lỗi kết nối có thông báo thử tải lại', async (t) => {
  mockFetch(t, async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(getLisResults(), /Không thể kết nối.*thử tải lại/)
})

test('API: phản hồi thành công sai JSON hoặc sai cấu trúc không bị coi là danh sách rỗng', async (t) => {
  const invalid = [
    () => new Response('not json'),
    () => Response.json({ items: [], limit: 10, offset: 0 }),
    () => Response.json({ items: [result({ result_status: 'ACK' })], limit: 11, offset: 0 }),
    () => Response.json({ items: [result({ effective_at: undefined })], limit: 11, offset: 0 }),
  ]
  for (const response of invalid) {
    mockFetch(t, async () => response())
    await assert.rejects(getLisResults(), /không.*hợp lệ/)
    t.mock.restoreAll()
  }
})

test('API: chuyển tiếp việc hủy yêu cầu, không đổi thành lỗi kết nối', async (t) => {
  const controller = new AbortController()
  controller.abort()
  mockFetch(t, async (_url, { signal }) => { signal.throwIfAborted() })
  await assert.rejects(getLisResults({ signal: controller.signal }), { name: 'AbortError' })
})

test('Phân trang: dòng thứ 11 chỉ dùng để xác định trang sau', () => {
  for (const size of [0, 1, 9, 10, 11]) {
    const items = Array.from({ length: size }, (_, index) => result({ result_id: String(index) }))
    const page = resultsPage(items)
    assert.equal(page.items.length, Math.min(size, 10))
    assert.equal(page.hasNext, size === 11)
    assert.equal(items.length, size)
  }
})

test('Truy vấn: tìm kiếm, xóa và thử lại; phân trang giữ bộ lọc đã áp dụng', () => {
  const filters = { patientId: ' P1 ', testCode: 't1', resultStatus: 'FINAL' }
  let query = resultsQueryReducer(initialQuery, { type: 'search', filters })
  filters.patientId = 'đang nhập điều kiện khác'
  query = resultsQueryReducer(query, { type: 'next' })
  assert.equal(query.pageIndex * 10, 10)
  assert.equal(query.filters.patientId, 'P1')
  const retried = resultsQueryReducer(query, { type: 'retry' })
  assert.notEqual(retried, query)
  assert.deepEqual(retried, query)
  assert.equal(resultsQueryReducer(query, { type: 'previous' }).pageIndex, 0)
  assert.equal(resultsQueryReducer(initialQuery, { type: 'previous' }).pageIndex, 0)
  const searched = resultsQueryReducer(query, { type: 'search', filters: query.filters })
  assert.equal(searched.pageIndex, 0)
  assert.notEqual(resultsQueryReducer(searched, { type: 'search', filters: searched.filters }), searched)
  assert.deepEqual(resultsQueryReducer(query, { type: 'reset' }), initialQuery)
})
