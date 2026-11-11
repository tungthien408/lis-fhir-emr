import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existingPublishNotice, publishFeedback } from '../src/flow/publishFeedback.ts'
import { fixture } from './flow-fixtures.mjs'

test('Thông báo phân biệt DELIVERED, đang xử lý, ACK thiếu bằng chứng và thất bại', async () => {
  assert.match(existingPublishNotice(await fixture()), /đã được gửi thành công trước đó/)
  assert.match(existingPublishNotice(await fixture('PROCESSING')), /đang trong quá trình trao đổi/)
  const ack = await fixture('PROCESSING')
  ack.detail = null
  assert.match(existingPublishNotice(ack), /Chưa xác nhận trao đổi hoàn tất/)
  for (const status of ['PENDING', 'IN_FLIGHT', 'RETRY_WAIT']) {
    ack.publish.event.dispatch_status = status
    assert.match(existingPublishNotice(ack), /Không cần gửi lại/)
  }
  assert.match(existingPublishNotice(await fixture('REJECTED')), /Chưa xác nhận trao đổi hoàn tất/)
  const incomplete = await fixture()
  incomplete.detail.verified_at = null
  assert.doesNotMatch(existingPublishNotice(incomplete), /đã được gửi thành công/)
})

test('202 chỉ xác nhận lưu yêu cầu; 200 giữ thông tin idempotency dù đọc lại lỗi hoặc timeout', async (t) => {
  const data = await fixture()
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network') })
  const signal = new AbortController().signal
  assert.match(await publishFeedback({ created: true, event: data.publish.event }, signal), /Chưa xác nhận kết quả/)
  for (const lookupSignal of [signal, AbortSignal.abort()]) {
    const notice = await publishFeedback({ created: false, event: data.publish.event }, lookupSignal)
    assert.match(notice, /idempotency/)
    assert.match(notice, /Chưa đọc lại được trạng thái/)
    assert.doesNotMatch(notice, /đã được gửi thành công/)
  }
})
