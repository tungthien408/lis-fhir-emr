import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openHttpBrowser, until } from '/home/thien408/Projects/2026-2027/dacn/lis-fhir-emr/frontend/apps/lis/tests/helpers/http-browser.mjs';
const out = path.resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
const exchanges = await (await fetch('http://127.0.0.1:3102/api/exchanges?status=DELIVERED&limit=1&offset=0')).json();
assert.ok(exchanges.items?.length);
const id = exchanges.items[0].source_result_id;
const result = await (await fetch('http://127.0.0.1:3101/api/results/' + encodeURIComponent(id))).json();
const report = { result_id: id, patient_id: result.patient_id, apps: [] };
for (const app of ['lis', 'emr', 'middleware-monitor']) {
  const browser = await openHttpBrowser(null, { mode: 'preview', app, publishRequests: true, flowRequests: true });
  try {
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1100, deviceScaleFactor: 1, mobile: false });
    await browser.navigate('#/flow?result_id=' + encodeURIComponent(id));
    await until(() => browser.evaluate(() => document.querySelector('[data-flow-status]')?.getAttribute('data-flow-status') === 'DELIVERED'), 'real delivered status');
    await until(() => browser.evaluate(() => !!document.querySelector('.emr-result')), 'real EMR result');
    assert.equal(await browser.evaluate(() => document.querySelectorAll('.comparison-table [aria-label="Khớp"]').length), 9);
    assert.ok(await browser.evaluate(() => document.querySelector('.patient-label')?.textContent?.includes('hồ sơ EMR')));
    await browser.evaluate(async () => { await document.fonts.ready; });
    writeFileSync(path.join(out, app + '-delivered.png'), Buffer.from(await browser.screenshot(), 'base64'));
    await browser.evaluate(patient => {
      const input = document.querySelector('#flow-search');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, patient);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, result.patient_id);
    await browser.evaluate(() => document.querySelector('form.flow-search').requestSubmit());
    await until(() => browser.evaluate(patient => {
      const rows = [...document.querySelectorAll('.flow-result .result-identifiers small')];
      return rows.length > 0 && rows.every(row => row.title === patient);
    }, result.patient_id), 'patient search returns matching identities');
    await browser.evaluate(() => document.querySelector('#tab-log').click());
    await until(() => browser.evaluate(() => !!document.querySelector('.evidence-technical')), 'attempt details');
    await browser.evaluate(() => { const detail = document.querySelector('.evidence-technical'); detail.open = true; detail.scrollIntoView({ block: 'center' }); });
    await until(() => browser.evaluate(() => document.querySelector('.evidence-technical')?.textContent?.includes('STORED')), 'monitor storage receipt');
    writeFileSync(path.join(out, app + '-receipt.png'), Buffer.from(await browser.screenshot(), 'base64'));
    assert.equal(browser.exceptions.length, 0);
    assert.ok(browser.requests.length > 0 && browser.requests.every(request => request.method === 'GET'));
    report.apps.push({ app, outcome: 'PASS', checks: ['DELIVERED', '9 field matches', 'linked EMR patient', 'patient search', 'STORED receipt', 'GET only'], requests: browser.requests, chrome: browser.version });
  } finally { await browser.close(); }
}
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outcome: 'PASS', apps: report.apps.length, result_id: id, patient_id: result.patient_id }));
