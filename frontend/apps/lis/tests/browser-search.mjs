import assert from 'node:assert/strict'
import { openHttpBrowser, until } from './helpers/http-browser.mjs'
import { fixture } from './flow-fixtures.mjs'

// Synthetic source records include the exact IDs from the reported bug.
const records = new Map(await Promise.all(Array.from({ length: 26 }, async (_, index) => {
  const id = 'MIMIC-LAB-' + (100120 + index)
  const data = await fixture('READY', id)
  data.source.patient_id = [0, 22].includes(index) ? 'MIMIC-P-10007928' : 'MIMIC-P-' + (20000000 + index)
  if (index === 25) data.source.result_status = data.publish.result_status = 'READY'
  return [id, data]
})))
let delayed, rootNavigations = 0, posts = 0
const cases = []
const browser = await openHttpBrowser(async req => {
  const url = new URL(req.url)
  if (req.method !== 'GET') { posts++; throw new Error('Search must never write') }
  if (url.pathname === '/api/lis/results') {
    const q = url.searchParams, term = (q.get('search') ?? '').toLowerCase()
    assert.equal(q.get('result_status'), 'FINAL')
    if (term === 'error-400') return { status: 400, json: { error: { code: 'VALIDATION_ERROR', message: 'Simulated previous backend version' } } }
    const rows = [...records.values()].map(d => d.source).filter(row => row.result_status === q.get('result_status')
      && [row.patient_id, row.result_id].some(id => id.toLowerCase().includes(term)))
    const limit = Number(q.get('limit')), offset = Number(q.get('offset'))
    if (term === '100142' && delayed) await delayed
    return { json: { items: rows.slice(offset, offset + limit), limit, offset } }
  }
  const match = /^\/api\/lis\/results\/([^/]+)(\/publish-event)?$/.exec(url.pathname)
  assert.ok(match, 'Unexpected endpoint ' + url.pathname)
  const data = records.get(decodeURIComponent(match[1]))
  assert.ok(data)
  return { json: match[2] ? data.publish : data.source }
}, { publishRequests: true, flowRequests: true, onEvent: event => {
  if (event.method === 'Page.frameNavigated' && !event.params.frame.parentId) rootNavigations++
} })
const listRequests = () => browser.requests.filter(r => new URL(r.url).pathname === '/api/lis/results')
const visibleIds = () => browser.evaluate(() => [...document.querySelectorAll('.flow-result .mono')].map(e => e.title))
async function input(value, submit = true) {
  await browser.evaluate(value => {
    const input = document.getElementById('flow-search')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  if (submit) await browser.evaluate(() => document.querySelector('.flow-search').requestSubmit())
}
async function waitList(ids) {
  await until(async () => JSON.stringify(await visibleIds()) === JSON.stringify(ids)
    && await browser.evaluate(() => !document.querySelector('.flow-result-list [role="status"], .flow-result-list [role="alert"]')), 'List ' + ids.join(','))
}
const initialIds = [...records.keys()].slice(0, 10)
async function clear() {
  const before = listRequests().length
  await browser.evaluate(() => document.querySelector('[aria-label="Xóa tìm kiếm"]').click())
  await until(() => listRequests().slice(before).some(r => !r.query.search && r.fulfilled), 'Restored response')
  await waitList(initialIds)
  assert.equal(await browser.evaluate(() => document.getElementById('flow-search').value), '')
  assert.equal(await browser.evaluate(() => !!document.querySelector('[aria-label="Xóa tìm kiếm"]')), false)
  assert.deepEqual(listRequests().at(-1).query, { limit: '11', offset: '0', result_status: 'FINAL' })
}
try {
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1100, deviceScaleFactor: 1, mobile: false })
  await browser.navigate(); await waitList(initialIds)
  await until(() => browser.evaluate(() => document.querySelector('.source-facts')?.textContent.includes('MIMIC-LAB-100120')), 'Initial detail')
  const navigations = rootNavigations
  await browser.evaluate(() => { window.searchDocument = document; window.searchList = document.querySelector('.flow-result-list') })
  assert.equal(await browser.evaluate(() => document.getElementById('flow-search').placeholder), 'Tìm mã bệnh nhân/mã kết quả')
  assert.equal(await browser.evaluate(() => !!document.querySelector('[aria-label="Xóa tìm kiếm"]')), false)

  for (const keyword of ['MIMIC-P-10007928', 'mimic-p-10007928', ' P-10007928 ', '10007928']) {
    await input(keyword)
    await waitList(['MIMIC-LAB-100120', 'MIMIC-LAB-100142'])
    assert.equal(listRequests().at(-1).query.search, keyword.trim())
  }
  cases.push('1/3/4: patient full/lowercase/partial, trimmed, FINAL and outside current page')
  for (const keyword of ['MIMIC-LAB-100142', ' mimic-lab-100142 ', 'LAB-100142', '100142']) {
    await input(keyword)
    await waitList(['MIMIC-LAB-100142'])
    assert.equal(listRequests().at(-1).status, 200)
  }
  cases.push('2/3/4: result full/lowercase/partial and exact reported ID')
  await clear()
  cases.push('5: X restores original FINAL page, clears input and hides itself')

  await input('100142', false)
  await waitList(['MIMIC-LAB-100142'])
  await browser.evaluate(() => { const input = document.getElementById('flow-search'); input.focus(); input.select() })
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await waitList(initialIds)
  assert.equal(await browser.evaluate(() => document.getElementById('flow-search').value), '')
  cases.push('6: actual Backspace clears input and restores list automatically; typing uses debounce')

  await input('MIMIC-LAB-NOT-FOUND')
  await until(() => browser.evaluate(() => document.querySelector('.flow-result-list')?.textContent.includes('Không có kết quả phù hợp')), 'Empty results')
  assert.equal(listRequests().at(-1).status, 200)
  assert.equal(await browser.evaluate(() => !!document.querySelector('.flow-result-list [role="alert"]')), false)
  await clear()
  cases.push('7: nonexistent valid ID returns HTTP 200 empty; X recovers')

  await input('ERROR-400')
  await until(() => browser.evaluate(() => document.querySelector('.flow-result-list [role="alert"]')?.textContent.includes('HTTP 400')), 'Old backend error')
  await clear()
  assert.equal(await browser.evaluate(() => !!document.querySelector('.flow-result-list [role="alert"]')), false)
  cases.push('Previous HTTP 400 is removed and original list fetched after clear')

  let release
  delayed = new Promise(resolve => { release = resolve })
  const start = listRequests().length
  await input('100142')
  await until(() => listRequests().slice(start).some(r => r.query.search === '100142'), 'Delayed request started')
  await input('10007928')
  await waitList(['MIMIC-LAB-100120', 'MIMIC-LAB-100142'])
  await clear()
  release(); delayed = null
  await until(() => listRequests().slice(start).some(r => r.query.search === '100142' && (r.cancelled || r.fulfilled)), 'Old response finished')
  // Allow pending network/React work to settle after releasing the older response.
  await browser.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await visibleIds(), initialIds)
  await input('100142', false)
  await clear() // Cancels a debounce which has not fired yet.
  await browser.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)))
  assert.deepEqual(await visibleIds(), initialIds)
  cases.push('8: stale request and pending debounce cannot overwrite restored list')

  await input('1001')
  await until(() => listRequests().at(-1)?.query.search === '1001' && listRequests().at(-1)?.fulfilled, 'Search list response')
  await waitList(initialIds)
  const scroll = await browser.evaluate(() => {
    const list = document.querySelector('.flow-result-list')
    list.scrollTop = 200
    const top = list.scrollTop
    list.querySelectorAll('.flow-result')[6].click()
    return top
  })
  await until(() => browser.evaluate(() => document.querySelector('.source-facts')?.textContent.includes('MIMIC-LAB-100126')), 'Selection detail')
  assert.ok(scroll > 0)
  assert.deepEqual(await browser.evaluate(() => ({ same: window.searchList === document.querySelector('.flow-result-list'), top: document.querySelector('.flow-result-list').scrollTop })), { same: true, top: scroll })
  const selectedHash = await browser.evaluate(() => location.hash)
  await clear()
  assert.equal(await browser.evaluate(() => location.hash), selectedHash)
  assert.ok(await browser.evaluate(() => document.querySelector('.source-facts').textContent.includes('MIMIC-LAB-100126')))
  cases.push('9: selection retains scroll/list DOM; clearing retains selected result')

  await browser.evaluate(() => document.querySelector('[aria-label="Trang sau"]').click())
  await until(() => browser.evaluate(() => document.querySelector('.flow-result .mono')?.title === 'MIMIC-LAB-100130'), 'Second page')
  await input('100142'); await waitList(['MIMIC-LAB-100142']); await clear()
  assert.equal(listRequests().at(-1).query.offset, '0')
  assert.equal(await browser.evaluate(() => window.searchDocument === document), true)
  assert.equal(rootNavigations, navigations)
  assert.equal(posts, 0)
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.interceptionErrors, [])
  cases.push('10: page resets to first page; document never reloads; zero Publish requests')
  console.log(JSON.stringify({ result: 'PASS', cases, posts }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ cases, posts, requests: listRequests().slice(-10).map(({ query, status, fulfilled, cancelled }) => ({ query, status, fulfilled, cancelled })), text: await browser.evaluate(() => document.querySelector('.flow-result-list')?.textContent), interceptionErrors: browser.interceptionErrors }, null, 2))
  throw error
} finally { await browser.close() }
