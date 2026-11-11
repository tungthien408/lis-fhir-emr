import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flowModel, comparisons, decimal, instant, duration, hashJson } from '../src/flow/model.ts'
import { loadFlow } from '../src/flow/api.ts'
import { fixture, id } from './flow-fixtures.mjs'

test('four API states: ready, processing, delivered and rejected at SEND', async () => {
  const ready = flowModel(await fixture('READY'))
  assert.equal(ready.label, 'SẴN SÀNG'); assert.deepEqual(ready.stages, ['idle', 'idle', 'idle', 'idle', 'idle'])
  const processing = flowModel(await fixture('PROCESSING'))
  assert.equal(processing.delivered, false); assert.deepEqual(processing.stages, ['done', 'done', 'active', 'idle', 'idle'])
  const delivered = flowModel(await fixture())
  assert.equal(delivered.label, 'DELIVERED'); assert.ok(delivered.stages.every(s => s === 'done')); assert.ok(delivered.rows.every(r => r.match))
  const rejected = flowModel(await fixture('REJECTED'))
  assert.equal(rejected.label, 'REJECTED'); assert.equal(rejected.failedStage, 3)
  assert.deepEqual(rejected.stages, ['done', 'done', 'done', 'error', 'idle'])
  assert.equal(rejected.code, 'REMOTE_VALIDATION_ERROR'); assert.ok(!rejected.captions.join('').includes('PATIENT_NOT_LINKED'))
})
test('ACK, storage alone, missing VERIFY receipt, invalid hash never prove delivery', async () => {
  for (const change of [d => { d.detail.verified_at = null }, d => { d.attempts.items.pop() }, d => { d.attempts = null }, d => { d.hashes.fhir = 'c'.repeat(64) }, d => { d.detail.source_payload.event_id = 'wrong' }]) {
    const data = await fixture(); change(data); assert.equal(flowModel(data).delivered, false)
  }
})
test('dispatch BLOCKED/FAILED and mapping failure stop at the evidenced stage', async () => {
  for (const status of ['BLOCKED', 'FAILED']) {
    const d = await fixture('READY'); d.publish.event = { ...(await fixture()).publish.event, dispatch_status: status, exchange_id: null, acked_at: null, last_error_code: 'HTTP_PERMANENT' }
    d.publish.published = true
    assert.equal(flowModel(d).failedStage, 1)
  }
  const d = await fixture('PROCESSING'); d.detail.status = 'REJECTED'; d.attempts.diagnostics = [{ occurred_at: d.detail.received_at, error_code: 'MAPPING_UNSUPPORTED' }]
  assert.equal(flowModel(d).failedStage, 2)
})
test('VERIFY retry/mismatch and duplicate receipts remain distinct', async () => {
  const d = await fixture(); d.detail.status = 'RETRY_WAIT'; d.detail.retry_phase = 'VERIFY'; d.detail.verified_at = null
  assert.equal(flowModel(d).stages[4], 'active'); assert.equal(flowModel(d).delivered, false)
  d.detail.status = 'FAILED'; d.attempts.items[1].error_code = 'VERIFY_MISMATCH'
  assert.equal(flowModel(d).failedStage, 4)
  const duplicate = await fixture(); duplicate.attempts.items[0].http_status = 200; duplicate.attempts.items[0].receipt.result = 'ALREADY_EXISTS'
  assert.equal(flowModel(duplicate).delivered, true); assert.match(flowModel(duplicate).captions[3], /ALREADY_EXISTS/)
})
test('comparison uses published snapshot, exact decimal, microseconds and null bounds', async () => {
  const d = await fixture(); d.source.value_num = '100'; assert.ok(comparisons(d).every(r => r.match))
  d.emr.result.quantity = '3.600000000000000000001'; assert.equal(comparisons(d).find(r => r.label === 'Giá trị').match, false)
  assert.notEqual(decimal('3.600000000000000000001'), decimal(3.6)); assert.equal(decimal('3.6000'), decimal(3.6))
  assert.notEqual(instant('2026-11-09T01:00:00.123456Z'), instant('2026-11-09T01:00:00.123457Z'))
  assert.equal(instant('2026-11-09T01:00:00.123456Z'), instant('2026-11-09T08:00:00.123456+07:00'))
  d.emr.result.high = '0'; assert.equal(comparisons(d).find(r => r.label === 'Cận cao').match, false)
  assert.equal(duration(null, null), '—'); assert.equal(duration('2026-01-02', '2026-01-01'), '—')
  assert.equal(await hashJson({ b: 2, a: 1 }), await hashJson({ a: 1, b: 2 }))
})
test('API aggregation reads actual endpoints; rejects crossed event and patient receipts', async t => {
  let d = await fixture(), requests = []
  t.mock.method(globalThis, 'fetch', async path => {
    requests.push(String(path))
    if (path.endsWith('/publish-event')) return Response.json(d.publish)
    if (path.startsWith('/api/lis/results/')) return Response.json(d.source)
    if (path.endsWith('/attempts')) return Response.json(d.attempts)
    if (path.startsWith('/api/middleware/exchanges/')) return Response.json(d.detail)
    if (path.startsWith('/api/emr/lab-results?')) return Response.json({ items: [d.emr.result] })
    if (path.startsWith('/api/emr/patients?')) return Response.json({ patient: d.emr.patient })
    throw new Error('Unexpected request: ' + path)
  })
  let loaded = await loadFlow(id, new AbortController().signal)
  assert.equal(loaded.warnings.length, 0); assert.equal(flowModel(loaded).delivered, true)
  assert.ok(requests.some(p => p.includes('/attempts'))); assert.ok(requests.some(p => p.includes('external_system=')))
  d.detail.event_id = '00000000-0000-4000-8000-000000000099'
  loaded = await loadFlow(id, new AbortController().signal); assert.equal(loaded.detail, null); assert.ok(loaded.warnings.length)
  d = await fixture(); d.emr.result.target_id = '00000000-0000-4000-8000-000000000099'
  loaded = await loadFlow(id, new AbortController().signal); assert.equal(loaded.emr, null); assert.ok(loaded.warnings.length)
})
