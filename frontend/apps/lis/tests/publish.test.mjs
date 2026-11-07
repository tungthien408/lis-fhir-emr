import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getResultPublishState, publishResult, getExchangeStatus, validatePublishState } from '../src/api/publish.ts'
import { lisResultRequest } from '../src/api/resultRequest.ts'
import { withDotResultProxy } from '../proxy/lis.ts'

const eventId = '00000000-0000-4000-8000-000000000001', exchangeId = '00000000-0000-4000-8000-000000000002'
const event = { event_id: eventId, result_id: 'R1', dispatch_status: 'PENDING', exchange_id: null,
  dispatch_attempt_count: 0, last_error_code: null, last_error_message: null, published_at: '2026-11-04T05:00:00.000Z', acked_at: null, next_retry_at: null }
const state = { result_id: 'R1', result_status: 'FINAL', published: true, event }

test('Publish: 202 mới/200 lặp, chỉ POST đúng ID; giữ signal và không tự gửi lại', async (t) => {
  for (const status of [202, 200]) {
    let count = 0
    const controller = new AbortController()
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      count++; assert.equal(path, '/api/lis/results/R1/publish'); assert.equal(options.method, 'POST')
      assert.equal(options.body, undefined); assert.equal(options.signal, controller.signal)
      return Response.json(event, { status })
    })
    const response = await publishResult('R1', controller.signal)
    assert.equal(response.created, status === 202); assert.equal(response.event.event_id, eventId); assert.equal(count, 1)
    t.mock.restoreAll()
  }
})

test('Lookup: chưa Publish khác missing, lỗi hệ thống; không POST khi đọc', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/lis/results/R1/publish-event'); assert.equal(options.method, undefined)
    return Response.json({ result_id: 'R1', result_status: 'READY', published: false, event: null })
  })
  assert.equal((await getResultPublishState('R1')).published, false)
  t.mock.restoreAll()
  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [404, 'NOT_FOUND'], [409, 'CONTENT_CONFLICT'], [422, 'RESULT_NOT_READY'], [503, 'DEPENDENCY_UNAVAILABLE']]) {
    let count = 0
    t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json({ error: { code } }, { status }) })
    await assert.rejects(publishResult('R1'), (e) => e.status === status && e.code === code)
    assert.equal(count, 1)
    await assert.rejects(getResultPublishState('R1'))
    t.mock.restoreAll()
  }
})

test('Lookup: kiểm identity, kiểu, published/event và dấu mốc ACK', () => {
  assert.deepEqual(validatePublishState(state, 'R1'), state)
  const bad = [{ ...state, result_id: 'WRONG' }, { ...state, event: null }, { ...state, published: false },
    { ...state, event: { ...event, result_id: 'WRONG' } }, { ...state, event: { ...event, event_id: 'bad' } },
    { ...state, event: { ...event, dispatch_status: 'DELIVERED' } }, { ...state, event: { ...event, dispatch_attempt_count: -1 } },
    { ...state, event: { ...event, published_at: 'not-date' } }, { ...state, event: { ...event, dispatch_status: 'ACK' } }]
  for (const value of bad) assert.throws(() => validatePublishState(value, 'R1'))
})

test('Middleware: DELIVERED phải đúng event/result/source/exchange và có mốc verified/completed', async (t) => {
  const receipt = { ...event, dispatch_status: 'ACK', exchange_id: exchangeId }
  const exchange = { exchange_id: exchangeId, event_id: eventId, source_system: 'lis-demo', source_result_id: 'R1', status: 'DELIVERED',
    retry_phase: null, verified_at: '2026-11-04T05:01:00.000Z', completed_at: '2026-11-04T05:01:00.000Z' }
  for (const patch of [null, { event_id: 'WRONG' }, { source_result_id: 'WRONG' }, { source_system: 'other' }, { exchange_id: eventId }, { verified_at: null }, { completed_at: null }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...exchange, ...patch }))
    if (patch) await assert.rejects(getExchangeStatus(receipt), /không hợp lệ|không khớp/)
    else assert.equal((await getExchangeStatus(receipt)).status, 'DELIVERED')
    t.mock.restoreAll()
  }
})

test('Publish proxy: giữ dot/literal/slash/percent/Unicode cho POST và lookup; không rewrite method khác', () => {
  for (const id of ['.', '..', '%2E', '%2E%2E', '/', '%', '+', 'Kết quả/🧪?#']) {
    for (const action of ['publish', 'publish-event']) {
      const wire = lisResultRequest(id, action)
      const req = { url: wire.path, method: action === 'publish' ? 'POST' : 'GET', headers: { 'x-lis-dot-segment': wire.headers?.['X-LIS-Dot-Segment'] } }
      const proxy = withDotResultProxy({}); proxy.bypass(req, {}, proxy)
      assert.equal(req.url, '/api/lis/results/' + (['.', '..'].includes(id) ? id.replaceAll('.', '%2E') : encodeURIComponent(id)) + '/' + action)
      assert.equal(req.headers['x-lis-dot-segment'], undefined)
    }
  }
})

test('Lỗi JSON, mạng, schema/ID sai và abort không trở thành Publish thành công', async (t) => {
  for (const response of [() => new Response('<html>bad</html>'), () => Response.json({ ...event, result_id: 'WRONG' }),
    () => { throw new TypeError('network') }]) {
    let count = 0
    t.mock.method(globalThis, 'fetch', async () => { count++; return response() })
    await assert.rejects(publishResult('R1')); assert.equal(count, 1); t.mock.restoreAll()
  }
  const controller = new AbortController(); controller.abort()
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => signal.throwIfAborted())
  await assert.rejects(publishResult('R1', controller.signal), { name: 'AbortError' })
})


test('Lookup 404: route thiếu, bản ghi thiếu và HTML đều là lỗi, không thành chưa Publish', async (t) => {
  for (const [message, expected] of [
    ['API route not found', /chưa hỗ trợ đường dẫn API/],
    ['Laboratory result not found', /Không tìm thấy kết quả xét nghiệm/],
    ['Other error', /Không tìm thấy kết quả, sự kiện hoặc đường dẫn API/],
  ]) {
    let count = 0
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      count++; assert.equal(options.method, undefined)
      return Response.json({ error: { code: 'NOT_FOUND', message } }, { status: 404 })
    })
    await assert.rejects(getResultPublishState('R1'), e => e.status === 404 && expected.test(e.message))
    assert.equal(count, 1); t.mock.restoreAll()
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>not found</html>', { status: 404 }))
  await assert.rejects(getResultPublishState('R1'), e => e.status === 404)
})
