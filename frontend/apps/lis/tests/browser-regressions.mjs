import assert from 'node:assert/strict'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'
import { fixture } from './flow-fixtures.mjs'

// Real React/DOM and HTTP interception; synthetic records only, no writes to Compose.
const records = new Map(await Promise.all(Array.from({ length: 26 }, async (_, i) => {
  const id = 'MIMIC-LAB-' + String(i + 1).padStart(3, '0')
  const data = await fixture(i === 9 ? 'DELIVERED' : 'READY', id)
  if (i === 25) { data.source.result_status = 'READY'; data.publish.result_status = 'READY' }
  return [id, data]
})))
let active = records.get('MIMIC-LAB-001'), publishMode = 'new', posts = 0, delayReads, delayPublish
const browser = await openHttpBrowser(async req => {
  const url = new URL(req.url), p = url.pathname
  if (p === '/api/lis/results') {
    const q = url.searchParams, limit = Number(q.get('limit')), offset = Number(q.get('offset'))
    const rows = [...records.values()].map(d => d.source).filter(r =>
      (!q.get('search') || [r.result_id, r.patient_id].some(value => value.toLowerCase().includes(q.get('search').toLowerCase())))
      &&
      (!q.get('result_id') || r.result_id.toLowerCase().includes(q.get('result_id').toLowerCase()))
      && (!q.get('patient_id') || r.patient_id === q.get('patient_id'))
      && (!q.get('result_status') || r.result_status === q.get('result_status')))
    return { json: { items: rows.slice(offset, offset + limit), limit, offset } }
  }
  if (p.startsWith('/api/lis/results/')) {
    const id = decodeURIComponent(p.split('/')[4])
    active = records.get(id)
    assert.ok(active, 'Unknown synthetic result ' + id)
    if (req.method === 'POST') {
      posts++
      if (delayPublish) await delayPublish
      if (publishMode === 'network') return { networkError: true }
      if (publishMode === 'conflict') return { status: 409, json: { error: { code: 'CONTENT_CONFLICT' } } }
      if (publishMode === 'server') return { status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE' } } }
      active = await fixture(publishMode === 'duplicate' ? 'DELIVERED' : 'PROCESSING', id)
      records.set(id, active)
      return { status: publishMode === 'new' ? 202 : 200, json: active.publish.event }
    }
    if (delayReads) await delayReads
    return { json: p.endsWith('/publish-event') ? active.publish : active.source }
  }
  if (p.endsWith('/attempts')) return { json: active.attempts }
  if (p.startsWith('/api/middleware/exchanges/')) return { json: active.detail }
  if (p === '/api/emr/lab-results') return { json: { items: [active.emr.result] } }
  if (p === '/api/emr/patients') return { json: { patient: active.emr.patient } }
  throw new Error('Unexpected request ' + req.url)
}, { publishRequests: true, flowRequests: true })
const cases = []
const waitStatus = status => until(() => browser.evaluate(s => document.querySelector('[data-flow-status]')?.dataset.flowStatus === s, status), status)
const waitNotice = text => until(() => browser.evaluate(s => [...document.querySelectorAll('.lis-panel .flow-note')].some(e => e.textContent.includes(s) && getComputedStyle(e).position !== 'absolute'), text), text)
async function openReady(id) {
  await browser.navigate('#/flow?result_id=' + id)
  await until(() => browser.evaluate(id => document.querySelector('.source-facts')?.textContent.includes(id)
    && document.querySelector('[data-flow-status]')?.dataset.flowStatus === 'SẴN SÀNG'
    && !document.querySelector('.dispatch-button').disabled, id), 'Ready selection ' + id)
}
async function search(value) {
  const before = browser.requests.length
  await browser.evaluate(value => {
    const input = document.getElementById('flow-search')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await browser.evaluate(() => document.querySelector('.flow-search').requestSubmit())
  await until(() => browser.requests.slice(before).some(r => new URL(r.url).pathname === '/api/lis/results' && r.fulfilled), 'Search response')
  await until(() => browser.evaluate(() => !document.querySelector('.flow-result-list [role="status"]')), 'Search rendered')
}
async function select(index, scrollTop) {
  const before = browser.requests.filter(r => new URL(r.url).pathname === '/api/lis/results').length
  const { position, id } = await browser.evaluate(({ index, scrollTop }) => {
    const list = document.querySelector('.flow-result-list')
    window.regressionList = list
    list.scrollTop = scrollTop
    const position = list.scrollTop
    const button = list.querySelectorAll('button')[index]
    const id = button.querySelector('[title]').title
    button.click()
    return { position, id }
  }, { index, scrollTop })
  assert.ok(position > 0)
  await until(() => browser.evaluate(id => document.querySelector('.source-facts')?.textContent.includes(id) && !document.querySelector('.source-detail [role="status"]'), id), 'Selected detail')
  assert.deepEqual(await browser.evaluate(() => ({ same: window.regressionList === document.querySelector('.flow-result-list'), top: document.querySelector('.flow-result-list').scrollTop })), { same: true, top: position })
  assert.equal(browser.requests.filter(r => new URL(r.url).pathname === '/api/lis/results').length, before)
}
try {
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1100, deviceScaleFactor: 1, mobile: false })
  await browser.navigate(); await waitStatus('SẴN SÀNG')
  await select(5, 180); await waitStatus('SẴN SÀNG')
  await select(9, 10000); await waitStatus('DELIVERED')
  assert.equal(posts, 0)
  cases.push('BUG-01: same list DOM and scroll at middle/end; selection makes no list fetch or POST')

  let release
  delayReads = new Promise(resolve => { release = resolve })
  await browser.evaluate(() => {
    window.regressionStates = []
    window.regressionObserver = new MutationObserver(() => window.regressionStates.push({
      status: document.querySelector('[data-flow-status]')?.dataset.flowStatus,
      button: document.querySelector('.dispatch-button')?.textContent,
    }))
    window.regressionObserver.observe(document.querySelector('.flow-console'), { subtree: true, childList: true, attributes: true, characterData: true })
    document.querySelector('.dispatch-button').click()
  })
  await waitNotice('Đang kiểm tra trạng thái')
  assert.equal(posts, 0)
  release(); delayReads = null
  await waitNotice('đã được gửi thành công trước đó')
  await until(() => browser.evaluate(() => !document.querySelector('.dispatch-button').disabled), 'Inspection finished')
  await browser.evaluate(() => document.querySelector('[aria-label="Làm mới trạng thái"]').click())
  await until(() => browser.evaluate(() => !document.querySelector('.source-detail [role="status"]')), 'Refresh finished')
  const transitions = await browser.evaluate(() => { window.regressionObserver.disconnect(); return window.regressionStates })
  assert.ok(transitions.length)
  assert.ok(transitions.every(s => s.status === 'DELIVERED' && !s.button.includes('Đang gửi')), JSON.stringify(transitions))
  assert.equal(posts, 0)
  assert.equal(await browser.evaluate(() => document.querySelector('.flow-result-list') === window.regressionList), true)
  cases.push('BUG-03: delivered click and refresh stay DELIVERED on every DOM mutation; GET only')

  await browser.evaluate(() => document.querySelector('[aria-label="Trang sau"]').click())
  await until(() => browser.evaluate(() => document.querySelector('.flow-result')?.textContent.includes('LAB-011')), 'Second page')
  for (const value of ['  mimic-lab-025  ', 'lab-025', '025']) {
    await search(value)
    assert.equal(await browser.evaluate(() => document.querySelectorAll('.flow-result').length), 1)
    assert.ok(await browser.evaluate(() => document.querySelector('.flow-result').textContent.includes('LAB-025')))
    assert.equal(browser.requests.filter(r => new URL(r.url).pathname === '/api/lis/results').at(-1).query.offset, '0')
  }
  await search('026')
  assert.ok(await browser.evaluate(() => document.querySelector('.flow-result-list').textContent.includes('Không có kết quả phù hợp')))
  await search(' lab-0 ')
  await select(5, 180)
  assert.equal(await browser.evaluate(() => document.getElementById('flow-search').value), ' lab-0 ')
  await browser.evaluate(() => document.querySelector('[aria-label="Trang sau"]').click())
  await until(() => browser.evaluate(() => document.querySelector('.flow-result')?.textContent.includes('LAB-011')), 'Search next page')
  const query = browser.requests.filter(r => new URL(r.url).pathname === '/api/lis/results').at(-1).query
  assert.deepEqual({ search: query.search, result_status: query.result_status, offset: query.offset }, { search: 'lab-0', result_status: 'FINAL', offset: '10' })
  cases.push('BUG-02: full/partial/lowercase/trimmed ID outside current page; FINAL AND search, empty result, retained search and pagination')

  for (const [mode, id, expected] of [
    ['duplicate', 'MIMIC-LAB-021', 'đã được gửi thành công trước đó'],
    ['pending', 'MIMIC-LAB-022', 'Không cần gửi lại'],
    ['conflict', 'MIMIC-LAB-023', 'Phát hiện xung đột dữ liệu'],
    ['server', 'MIMIC-LAB-024', 'HTTP 503'],
    ['network', 'MIMIC-LAB-025', 'Không thể kết nối'],
  ]) {
    publishMode = mode
    await openReady(id)
    const before = posts
    await browser.evaluate(() => { const b = document.querySelector('.dispatch-button'); b.click(); b.click() })
    await waitNotice(expected)
    assert.equal(posts, before + 1)
    if (['duplicate', 'pending'].includes(mode)) {
      await waitNotice('idempotency')
      await until(() => browser.evaluate(() => !document.querySelector('.dispatch-button').disabled), 'Duplicate refresh')
      await browser.evaluate(() => document.querySelector('.dispatch-button').click())
      await waitNotice(expected)
      assert.equal(posts, before + 1)
    } else {
      assert.doesNotMatch(await browser.evaluate(() => document.querySelector('.lis-panel [role="alert"]').textContent), /idempotency|đã được gửi thành công/)
    }
  }
  cases.push('BUG-04: visible 200 duplicate delivered/pending, 409 conflict, 503 and network errors; single POST on double click')
  publishMode = 'new'
  delayPublish = new Promise(resolve => { release = resolve })
  await openReady('MIMIC-LAB-002')
  const before = posts
  await browser.evaluate(() => document.querySelector('.dispatch-button').click())
  await until(() => posts === before + 1, 'Pending POST')
  await browser.evaluate(() => { location.hash = '#/flow?result_id=MIMIC-LAB-003' })
  await waitStatus('SẴN SÀNG')
  await browser.evaluate(() => { location.hash = '#/flow?result_id=MIMIC-LAB-002' })
  await until(() => browser.evaluate(() => document.querySelector('.source-facts')?.textContent.includes('MIMIC-LAB-002') && !document.querySelector('.dispatch-button').disabled), 'Returning to aborted result does not retain busy state')
  release(); delayPublish = null
  cases.push('Selection change aborts pending action; returning to the result does not retain sending/busy state')
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.interceptionErrors, [])
  console.log(JSON.stringify({ result: 'PASS', cases, posts }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ cases, posts, text: await browser.evaluate(() => document.querySelector('.lis-panel')?.textContent), requests: browser.requests.slice(-12).map(({ method, url, status, fulfilled }) => ({ method, url, status, fulfilled })), interceptionErrors: browser.interceptionErrors }, null, 2))
  throw error
} finally { await browser.close() }
