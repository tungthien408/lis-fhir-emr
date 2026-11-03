import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { requeueFailed } from './requeue-failed.js';

type Row = Record<string, unknown>;
/** Scripted pg client: answers by SQL fragment and records every statement. */
function fake(answers: Array<[string, Row[]]>) {
  const sql: string[] = [];
  const client = { query: async (text: string) => {
    sql.push(text.replace(/\s+/g, ' ').trim());
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    if (/^update/i.test(text.trim())) return { rows: [], rowCount: 1 };
    if (/^insert/i.test(text.trim())) return { rows: [], rowCount: 1 };
    const hit = answers.find(([fragment]) => text.includes(fragment));
    return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0 };
  } } as unknown as pg.PoolClient;
  return { client, sql };
}
const lisEvent = (extra: Row = {}) => ['from lis.publish_events', [{ event_id: 'e1', dispatch_status: 'FAILED', exchange_id: null, ...extra }]] as [string, Row[]];
const lisLast = (error_code: string, attempt_no = 4) => ['from lis.dispatch_attempts', [{ attempt_no, error_code }]] as [string, Row[]];
const mwRow = (extra: Row = {}) => ['from integration.exchange_transactions', [{ exchange_id: 'x1', status: 'FAILED', send_attempt_count: 4, verify_attempt_count: 0,
  target_stored_at: null, mapped: true, ...extra }]] as [string, Row[]];
const mwLast = (error_code: string) => ['from integration.exchange_attempts', [{ error_code }]] as [string, Row[]];

test('requeue: dry-run changes nothing and rolls back', async () => {
  const { client, sql } = fake([lisEvent(), lisLast('NETWORK_ERROR')]);
  const outcome = await requeueFailed(client, 'lis', 'R1', 8, false);
  assert.equal(outcome.action, 'DRY_RUN'); assert.ok(!sql.some((s) => /^update/i.test(s))); assert.equal(sql.at(-1), 'ROLLBACK');
});
test('requeue: LIS confirm updates exactly the failed, exchange-less event and commits', async () => {
  const { client, sql } = fake([lisEvent(), lisLast('HTTP_TIMEOUT')]);
  assert.equal((await requeueFailed(client, 'lis', 'R1', 8, true)).action, 'REQUEUED');
  assert.ok(sql.some((s) => s.startsWith("update lis.publish_events set dispatch_status = 'RETRY_WAIT'") && s.includes("dispatch_status = 'FAILED' and exchange_id is null")));
  assert.equal(sql.at(-1), 'COMMIT');
});
for (const code of ['REMOTE_VALIDATION_ERROR', 'HTTP_PERMANENT', 'INVALID_ACK', 'DUPLICATE_CONFLICT']) {
  test(`requeue: LIS refuses a permanent failure (${code})`, async () => {
    const { client, sql } = fake([lisEvent(), lisLast(code)]);
    await assert.rejects(requeueFailed(client, 'lis', 'R1', 8, true), /LAST_FAILURE_NOT_TRANSIENT/);
    assert.ok(!sql.some((s) => /^update/i.test(s))); assert.equal(sql.at(-1), 'ROLLBACK');
  });
}
test('requeue: LIS refuses non-FAILED, event that already has an exchange, missing event and too-small budget', async () => {
  await assert.rejects(requeueFailed(fake([lisEvent({ dispatch_status: 'BLOCKED' })]).client, 'lis', 'R1', 8, true), /NOT_REQUEUEABLE:BLOCKED/);
  await assert.rejects(requeueFailed(fake([lisEvent({ exchange_id: 'x' }), lisLast('NETWORK_ERROR')]).client, 'lis', 'R1', 8, true), /NOT_REQUEUEABLE/);
  await assert.rejects(requeueFailed(fake([]).client, 'lis', 'R1', 8, true), /NOT_FOUND/);
  await assert.rejects(requeueFailed(fake([lisEvent(), lisLast('NETWORK_ERROR', 7)]).client, 'lis', 'R1', 7, true), /BUDGET_TOO_SMALL/);
  await assert.rejects(requeueFailed(fake([]).client, 'lis', 'R1', 1, true), /INVALID_BUDGET/);
});
test('requeue: Middleware SEND-phase failure resumes SEND and writes an audit event', async () => {
  const { client, sql } = fake([mwRow(), mwLast('NETWORK_ERROR')]);
  const outcome = await requeueFailed(client, 'middleware', 'R1', 8, true);
  assert.equal(outcome.phase, 'SEND');
  assert.ok(sql.some((s) => s.startsWith('insert into integration.exchange_events') && s.includes("'OPERATOR_REQUEUE'")));
});
test('requeue: Middleware stored-but-unverified failure resumes VERIFY only, never SEND', async () => {
  const { client } = fake([mwRow({ target_stored_at: '2026-11-03', send_attempt_count: 1, verify_attempt_count: 4 }), mwLast('HTTP_TEMPORARY')]);
  assert.equal((await requeueFailed(client, 'middleware', 'R1', 8, false)).phase, 'VERIFY');
});
for (const code of ['VERIFY_MISMATCH', 'INVALID_STORAGE_RESPONSE', 'REMOTE_VALIDATION_ERROR', 'DUPLICATE_CONFLICT']) {
  test(`requeue: Middleware refuses a permanent failure (${code}) and a REJECTED exchange`, async () => {
    await assert.rejects(requeueFailed(fake([mwRow(), mwLast(code)]).client, 'middleware', 'R1', 8, true), /LAST_FAILURE_NOT_TRANSIENT/);
    await assert.rejects(requeueFailed(fake([mwRow({ status: 'REJECTED' }), mwLast('NETWORK_ERROR')]).client, 'middleware', 'R1', 8, true), /NOT_REQUEUEABLE:REJECTED/);
  });
}
