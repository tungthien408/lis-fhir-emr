import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFlowRoute } from '../src/flow/routes.ts'

test('Only Flow routes preserve a selected identity, decoded exactly once', () => {
  for (const id of ['.', '..', '%2E', '%', '/', '+', '#', '?', ' Kết quả/AbC+%?# 🧪 ']) {
    assert.deepEqual(readFlowRoute('#/flow?result_id=' + encodeURIComponent(id)), { resultId: id, invalid: false, redirect: false })
  }
  for (const hash of ['', '#', '#/flow']) assert.deepEqual(readFlowRoute(hash), { resultId: '', invalid: false, redirect: false })
})

test('Retired routes return to Flow without interpreting legacy filters or invalid IDs', () => {
  for (const hash of ['#/results', '#/results/%ZZ', '#/exchanges/invalid', '#/patients/key', '#/search?value=%00', '#/result?external_id=x', '#/other']) {
    assert.deepEqual(readFlowRoute(hash), { resultId: '', invalid: false, redirect: true })
  }
})

test('Malformed Flow selection remains an error rather than opening an unrelated result', () => {
  for (const hash of ['#/flow?result_id=', '#/flow?result_id=%00', '#/flow?result_id=%ZZ', '#/flow?result_id=a&result_id=b', '#/flow?unknown=a', '#/flow??']) {
    assert.deepEqual(readFlowRoute(hash), { resultId: '', invalid: true, redirect: false })
  }
})
