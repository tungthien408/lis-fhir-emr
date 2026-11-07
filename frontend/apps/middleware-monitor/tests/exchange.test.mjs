import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readRoute, routeHash, normalizeSourceResultId } from '../src/state/routes.ts'
import { emptyQuery, statuses } from '../src/types/exchange.ts'
import { getDetail, getAttempts, listExchanges, validateDetail, validateAttempts, validateSummary, verifiedDelivery, identityVerified } from '../src/api/exchanges.ts'
import { detail, attempts, uuid } from './fixtures.mjs'

for (const source_result_id of ['.', '..', '%2E', '/', '%', '+', 'Kết quả/🧪?#']) test('Hash giữ định danh nguồn: ' + source_result_id, () => {
  const query = { source_result_id, status: 'FAILED', page: 3 }, hash = routeHash(query, uuid(1))
  assert.deepEqual(readRoute(hash), { kind: 'detail', id: uuid(1), query })
  assert.deepEqual(readRoute(routeHash(query)), { kind: 'list', query })
})
test('Route từ chối query lạ/lặp, UUID sai, trang sai và encoding hỏng; không mở rộng tìm kiếm', () => {
  for (const hash of ['#/other', '#/exchanges/bad', '#/exchanges?page=0', '#/exchanges?page=1.2', '#/exchanges?page=9007199254740991', '#/exchanges?status=ACK', '#/exchanges?event_id=x', '#/exchanges?status=FAILED&status=FAILED', '#/exchanges?source_result_id=%', '#/exchanges?source_result_id=%00']) assert.equal(readRoute(hash).kind, 'invalid', hash)
  assert.deepEqual(readRoute(''), { kind: 'list', query: emptyQuery })
})
for (const n of [0, 20, 21]) test('Danh sách ' + n + ' dòng: 20 hiển thị, limit 21, offset 40 và AND bộ lọc', async t => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const url = new URL(path, 'http://localhost'); assert.equal(url.pathname, '/api/middleware/exchanges')
    assert.deepEqual(Object.fromEntries(url.searchParams), { limit: '21', offset: '40', source_result_id: '/+%🧪', status: 'DELIVERED' })
    assert.equal(options.method, undefined); assert.equal(options.cache, 'no-store'); assert.equal(options.signal, controller.signal)
    return Response.json({ items: Array.from({ length: n }, (_, i) => detail(i + 1)), limit: 21, offset: 40 })
  })
  const result = await listExchanges({ source_result_id: ' /+%🧪 ', status: 'DELIVERED', page: 3 }, controller.signal)
  assert.equal(result.items.length, Math.min(n, 20)); assert.equal(result.hasNext, n === 21)
})
test('API chi tiết/attempts chỉ GET đúng UUID; giữ signal và validate identity', async t => {
  const d = detail(), a = attempts(d), c = new AbortController(); const paths = []
  t.mock.method(globalThis, 'fetch', async (path, opts) => { paths.push(path); assert.equal(opts.signal, c.signal); assert.equal(opts.method, undefined); return Response.json(path.endsWith('/attempts') ? a : d) })
  assert.deepEqual(await getDetail(d.exchange_id, c.signal), d); assert.deepEqual(await getAttempts(d.exchange_id, c.signal), a)
  assert.equal(paths.length, 2)
})
for (const status of statuses) test('Bảo toàn trạng thái, snapshot, null và timestamp: ' + status, () => {
  const d = detail(1, status); assert.deepEqual(validateDetail(d, d.exchange_id), d)
  assert.equal(validateDetail(d, d.exchange_id).source_payload.source_snapshot.effective_at, '2026-11-04T09:00:00.123456Z')
})
test('JSON/schema/identity sai không bị coi là danh sách rỗng hoặc giao dịch thành công', async t => {
  const d = detail(), a = attempts(d)
  for (const patch of [{ exchange_id: uuid(2) }, { events: null }, { verified_at: 'bad' }, { send_attempt_count: -1 }, { retry_phase: 'ACK' }]) assert.throws(() => validateDetail({ ...d, ...patch }, d.exchange_id))
  for (const patch of [{ exchange_id: uuid(3) }, { items: null }, { diagnostics: [{ error_code: 'X' }] }, { items: [{ ...a.items[0], phase: 'POST' }] }]) assert.throws(() => validateAttempts({ ...a, ...patch }, d.exchange_id))
  assert.throws(() => validateSummary({ ...d, source_result_id: '\u0000' }))
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [], offset: 1, limit: 21 }))
  await assert.rejects(listExchanges(emptyQuery))
})
test('DELIVERED cần đúng identity, đủ timestamps, receipt và VERIFY thành công; không suy ra từ ACK/POST', () => {
  const d = detail(), a = attempts(d); assert.equal(verifiedDelivery(d, a), true)
  for (const patch of [{ status: 'VERIFYING' }, { verified_at: null }, { target_stored_at: null }, { completed_at: null }, { source_payload: { ...d.source_payload, event_id: uuid(999) } }, { fhir_payload: null }]) assert.equal(verifiedDelivery({ ...d, ...patch }, a), false)
  assert.equal(verifiedDelivery(d, null), false)
  assert.equal(verifiedDelivery(d, { ...a, event_id: uuid(2) }), false)
  assert.equal(verifiedDelivery(d, { ...a, items: a.items.filter(x => x.phase === 'SEND') }), false)
  assert.equal(verifiedDelivery(d, { ...a, items: a.items.map(x => ({ ...x, receipt: null })) }), false)
  assert.equal(identityVerified({ ...d, source_payload: null }), false)
})
for (const [code, message, expected] of [[400, 'bad', 'Yêu cầu không hợp lệ'], [404, 'Exchange not found', 'Không tìm thấy giao dịch'], [404, 'API route not found', 'Cần cập nhật service Middleware'], [503, 'bad', 'chưa truy cập được dữ liệu']]) test('Lỗi HTTP ' + code + ' / ' + message, async t => {
  let count = 0; t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json({ error: { code: 'NOT_FOUND', message } }, { status: code }) })
  await assert.rejects(getDetail(uuid(1)), e => e.message.includes(expected)); assert.equal(count, 1)
})
test('Mất mạng, JSON hỏng, 404 HTML và abort không thành dữ liệu hợp lệ; không tự gửi lại', async t => {
  for (const response of [() => { throw new TypeError('network') }, () => new Response('<html>bad</html>'), () => new Response('<html>404</html>', { status: 404 })]) {
    let count = 0; t.mock.method(globalThis, 'fetch', async () => { count++; return response() }); await assert.rejects(getDetail(uuid(1))); assert.equal(count, 1); t.mock.restoreAll()
  }
  const c = new AbortController(); c.abort(); t.mock.method(globalThis, 'fetch', async (_path, { signal }) => signal.throwIfAborted())
  await assert.rejects(getDetail(uuid(1), c.signal), { name: 'AbortError' })
})


test('Chỉ nhận diện MIMIC-LAB hậu tố số; trim tìm kiếm, giữ nguyên mã khác và số 0 đầu', () => {
  for (const [input, expected] of [
    ['MIMIC-LAB-100145', 'MIMIC-LAB-100145'], ['mimic-lab-100145', 'MIMIC-LAB-100145'],
    [' Mimic-Lab-00145 ', 'MIMIC-LAB-00145'], [' Local-Result/AbC+%🧪 ', 'Local-Result/AbC+%🧪'],
    ['mimic-lab-abc', 'mimic-lab-abc'], ['mimic-lab-100145-extra', 'mimic-lab-100145-extra'],
    ['mimic-lab-1.2', 'mimic-lab-1.2'], ['mimic-lab-１２', 'mimic-lab-１２'],
    ['mimic-p-100', 'mimic-p-100'], [' A b C ', 'A b C'], [' ', ''],
  ]) assert.equal(normalizeSourceResultId(input), expected)
})
for (const input of ['MIMIC-LAB-100145', 'mimic-lab-100145', 'Mimic-Lab-100145', '  mimic-lab-100145  ']) test('GET chuẩn hóa MIMIC, giữ status/page và định danh response: ' + JSON.stringify(input), async t => {
  const original = detail(1, 'DELIVERED', 'MIMIC-LAB-100145')
  t.mock.method(globalThis, 'fetch', async path => {
    assert.deepEqual(Object.fromEntries(new URL(path, 'http://localhost').searchParams), { limit: '21', offset: '20', source_result_id: 'MIMIC-LAB-100145', status: 'DELIVERED' })
    return Response.json({ items: [original], limit: 21, offset: 20 })
  })
  const result = await listExchanges({ source_result_id: input, status: 'DELIVERED', page: 2 })
  assert.deepEqual(result.items, [original])
})
test('URL viết thường được chuẩn hóa khi F5/đọc lại, chi tiết và quay lại giữ status/page', () => {
  const query = { source_result_id: 'MIMIC-LAB-100145', status: 'DELIVERED', page: 2 }
  for (const suffix of ['', '/' + uuid(1)]) {
    const route = readRoute('#/exchanges' + suffix + '?source_result_id=%20mimic-lab-100145%20&status=DELIVERED&page=2')
    assert.deepEqual(route.query, query)
    assert.deepEqual(readRoute(routeHash(route.query, route.id)), route)
  }
})
test('Mã không tồn tại trả rỗng; mã ngoài MIMIC giữ exact case, không sửa ID trong kết quả', async t => {
  for (const [input, expected, items] of [
    [' mimic-lab-999999999999999999 ', 'MIMIC-LAB-999999999999999999', []],
    ['  Local-Result/AbC+%🧪  ', 'Local-Result/AbC+%🧪', [detail(2, 'FAILED', 'Local-Result/AbC+%🧪')]],
    ['mimic-lab-AbC', 'mimic-lab-AbC', []],
  ]) {
    t.mock.method(globalThis, 'fetch', async path => {
      assert.equal(new URL(path, 'http://localhost').searchParams.get('source_result_id'), expected)
      return Response.json({ items, limit: 21, offset: 0 })
    })
    assert.deepEqual((await listExchanges({ source_result_id: input, status: '', page: 1 })).items, items)
    t.mock.restoreAll()
  }
})
