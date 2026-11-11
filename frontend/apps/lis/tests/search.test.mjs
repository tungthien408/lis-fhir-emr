import assert from 'node:assert/strict'
import { test } from 'node:test'
import { searchLisResults } from '../src/api/searchResults.ts'
import { emptyFilters, normalizeFilters } from '../src/state/results.ts'

const row = {
  result_id: 'MIMIC-LAB-100145', patient_id: 'MIMIC-P-10007928', test_code: '50971',
  test_name: 'Potassium', fluid: 'Blood', category: 'Chemistry', value_num: '3.60000000000000000001',
  unit: 'mEq/L', reference_low: null, reference_high: '5.1', effective_at: null, result_status: 'FINAL',
}
const query = (filters = {}) => ({ filters: { ...emptyFilters, ...filters }, pageIndex: 4 })

test('Chuẩn hóa: chỉ mẫu MIMIC đúng loại/hậu tố số, trim, giữ nguyên ID khác', () => {
  assert.deepEqual(normalizeFilters({ ...emptyFilters, patientId: ' mimic-p-10007928 ', resultId: ' mImIc-LaB-100145 ', testCode: ' 50971 ' }),
    { ...emptyFilters, patientId: row.patient_id, resultId: row.result_id, testCode: row.test_code })
  for (const id of ['AbC+%?#/🧪', '.', '..', '%2E', 'mimic-p-abc', 'mimic-lab-123x', 'mimic-lab-123/4']) {
    const values = normalizeFilters({ ...emptyFilters, patientId: ' ' + id + ' ', resultId: ' ' + id + ' ' })
    assert.equal(values.patientId, id)
    assert.equal(values.resultId, id)
  }
  assert.equal(normalizeFilters({ ...emptyFilters, patientId: 'mimic-lab-123', resultId: 'mimic-p-123' }).resultId, 'mimic-p-123')
})

test('Mã kết quả được lọc tại server trước phân trang, kết hợp AND các điều kiện', async (t) => {
  let count = 0
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    count++
    const parsed = new URL(url, 'http://localhost')
    assert.equal(parsed.pathname, '/api/lis/results')
    assert.equal(parsed.searchParams.get('result_id'), row.result_id)
    assert.equal(parsed.searchParams.get('offset'), '40')
    assert.equal(options.signal, controller.signal)
    return Response.json({ items: [row], limit: 11, offset: 40 })
  })
  for (const extra of [{}, { patientId: ' mimic-p-10007928 ', testCode: ' 50971 ', resultStatus: 'FINAL' }]) {
    assert.deepEqual(await searchLisResults(query({ resultId: ' mimic-lab-100145 ', ...extra }), controller.signal), { items: [row], hasNext: false })
  }
  assert.equal(count, 2)
})

test('Không có result_id vẫn dùng lọc backend, limit 11, offset và chuẩn hóa bệnh nhân', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.deepEqual(Object.fromEntries(new URL(url, 'http://localhost').searchParams),
      { limit: '11', offset: '40', patient_id: row.patient_id, test_code: '50971', result_status: 'FINAL' })
    return Response.json({ items: Array.from({ length: 11 }, (_, i) => ({ ...row, result_id: String(i) })), limit: 11, offset: 40 })
  })
  const data = await searchLisResults(query({ patientId: ' mimic-p-10007928 ', testCode: ' 50971 ', resultStatus: 'FINAL' }))
  assert.equal(data.items.length, 10)
  assert.equal(data.hasNext, true)
})

test('Danh sách rỗng khác 404 route/HTML, 400, 503, mạng và cấu trúc sai', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [], limit: 11, offset: 40 }))
  assert.deepEqual(await searchLisResults(query({ resultId: 'MISSING' })), { items: [], hasNext: false })
  t.mock.restoreAll()
  const failures = [
    () => Response.json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, { status: 404 }),
    () => new Response('<html>not found</html>', { status: 404 }),
    () => Response.json({}, { status: 400 }), () => Response.json({}, { status: 503 }),
    () => Response.json({ ...row, result_id: 'WRONG' }),
    () => { throw new TypeError('Failed to fetch') },
  ]
  for (const response of failures) {
    t.mock.method(globalThis, 'fetch', async () => response())
    await assert.rejects(searchLisResults(query({ resultId: row.result_id })))
    t.mock.restoreAll()
  }
})

test('Mã đầy đủ/rút gọn, chữ thường và ký tự đặc biệt đi qua query nguyên vẹn; chuyển tiếp abort', async (t) => {
  for (const id of ['.', '..', '%2E', 'AbC+%?#/🧪', 'lab-100', '100145']) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(new URL(url, 'http://localhost').searchParams.get('result_id'), id)
      assert.equal(options.headers, undefined)
      return Response.json({ items: [{ ...row, result_id: id }], limit: 11, offset: 40 })
    })
    assert.equal((await searchLisResults(query({ resultId: id }))).items[0].result_id, id)
    t.mock.restoreAll()
  }
  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => signal.throwIfAborted())
  await assert.rejects(searchLisResults(query({ resultId: row.result_id }), controller.signal), { name: 'AbortError' })
})

test('Search chung gửi nguyên mã bệnh nhân/kết quả và một phần mã, cùng FINAL và phân trang', async (t) => {
  for (const search of [' MIMIC-P-10007928 ', ' mimic-lab-100142 ', 'P-10007', '100142', '%_']) {
    t.mock.method(globalThis, 'fetch', async url => {
      assert.deepEqual(Object.fromEntries(new URL(url, 'http://localhost').searchParams),
        { limit: '11', offset: '40', search: search.trim(), result_status: 'FINAL' })
      return Response.json({ items: [row], limit: 11, offset: 40 })
    })
    assert.deepEqual(await searchLisResults(query({ search, resultStatus: 'FINAL' })), { items: [row], hasNext: false })
    t.mock.restoreAll()
  }
})

test('Xóa search bỏ tham số khỏi request và khôi phục FINAL; không biến rỗng thành lỗi', async (t) => {
  for (const search of ['', '  ']) {
    t.mock.method(globalThis, 'fetch', async url => {
      assert.deepEqual(Object.fromEntries(new URL(url, 'http://localhost').searchParams),
        { limit: '11', offset: '0', result_status: 'FINAL' })
      return Response.json({ items: [], limit: 11, offset: 0 })
    })
    assert.deepEqual(await searchLisResults({ filters: { ...emptyFilters, search, resultStatus: 'FINAL' }, pageIndex: 0 }), { items: [], hasNext: false })
    t.mock.restoreAll()
  }
})
