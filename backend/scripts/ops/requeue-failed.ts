/**
 * SPP-73: operator re-drive of ONE transient-FAILED transaction (DEF-04/DEF-05).
 *
 *   requeue-failed.ts lis        <result_id> --budget N [--confirm]   (LIS_DATABASE_URL)
 *   requeue-failed.ts middleware <result_id> --budget N [--confirm]   (MIDDLEWARE_DATABASE_URL)
 *
 * Only moves FAILED -> RETRY_WAIT (due now); it never sends anything. The running Dispatcher/Worker performs the
 * resend, so the usual idempotency applies (identical stored bytes, Middleware returns the original exchange,
 * EMR answers 200 ALREADY_EXISTS). Dry-run unless --confirm. Refuses unless the last failure was transient
 * (network / timeout / 408 / 429 / 5xx) and the budget the operator DECLARES for the running service exceeds the
 * attempts already used; a too-small real budget just ends in FAILED again (no data is lost or duplicated).
 * Budget = delays.length + 1 for the Worker, delays.length + 1 (or LIS_DISPATCHER_MAX_ATTEMPTS) for the Dispatcher.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const TRANSIENT = new Set(["NETWORK_ERROR", "HTTP_TIMEOUT", "HTTP_TEMPORARY"]);
const fail = (message: string): never => { throw new Error(message); };

export interface RequeueOutcome { target: "lis" | "middleware"; result_id: string; action: "REQUEUED" | "DRY_RUN"; phase?: string; attempts_used: number; budget: number }

export async function requeueFailed(client: pg.PoolClient, target: "lis" | "middleware", resultId: string,
  budget: number, confirm: boolean): Promise<RequeueOutcome> {
  if (!Number.isSafeInteger(budget) || budget < 2 || budget > 100) fail("INVALID_BUDGET");
  await client.query("BEGIN");
  try {
    let outcome: RequeueOutcome;
    if (target === "lis") {
      const { rows } = await client.query(`select event_id, dispatch_status, exchange_id from lis.publish_events where result_id = $1 for update`, [resultId]);
      const event = rows[0] ?? fail("NOT_FOUND");
      if (event.dispatch_status !== "FAILED" || event.exchange_id !== null) fail(`NOT_REQUEUEABLE:${event.dispatch_status}`);
      const { rows: last } = await client.query(`select attempt_no, error_code from lis.dispatch_attempts where event_id = $1 order by attempt_no desc limit 1`, [event.event_id]);
      if (!last[0] || !TRANSIENT.has(last[0].error_code)) fail(`LAST_FAILURE_NOT_TRANSIENT:${last[0]?.error_code ?? "none"}`);
      if (last[0].attempt_no >= budget) fail(`BUDGET_TOO_SMALL:used=${last[0].attempt_no}`);
      outcome = { target, result_id: resultId, action: confirm ? "REQUEUED" : "DRY_RUN", attempts_used: last[0].attempt_no, budget };
      if (confirm) {
        const { rowCount } = await client.query(`update lis.publish_events set dispatch_status = 'RETRY_WAIT', next_retry_at = clock_timestamp(),
          lease_until = null, lease_token = null where event_id = $1 and dispatch_status = 'FAILED' and exchange_id is null`, [event.event_id]);
        if (rowCount !== 1) fail("CONCURRENT_CHANGE");
      }
    } else {
      const { rows } = await client.query(`select exchange_id, status, send_attempt_count, verify_attempt_count, target_stored_at, fhir_payload is not null as mapped
        from integration.exchange_transactions where source_result_id = $1 for update`, [resultId]);
      const exchange = rows[0] ?? fail("NOT_FOUND");
      if (exchange.status !== "FAILED") fail(`NOT_REQUEUEABLE:${exchange.status}`);
      const phase = exchange.target_stored_at === null ? "SEND" : "VERIFY";
      if (phase === "SEND" && !exchange.mapped) fail("NOT_MAPPED");
      const used = phase === "SEND" ? exchange.send_attempt_count : exchange.verify_attempt_count;
      const { rows: last } = await client.query(`select error_code from integration.exchange_attempts where exchange_id = $1 and phase = $2 order by attempt_no desc limit 1`, [exchange.exchange_id, phase]);
      if (!last[0] || !TRANSIENT.has(last[0].error_code)) fail(`LAST_FAILURE_NOT_TRANSIENT:${last[0]?.error_code ?? "none"}`);
      if (used >= budget) fail(`BUDGET_TOO_SMALL:used=${used}`);
      outcome = { target, result_id: resultId, action: confirm ? "REQUEUED" : "DRY_RUN", phase, attempts_used: used, budget };
      if (confirm) {
        const { rowCount } = await client.query(`update integration.exchange_transactions set status = 'RETRY_WAIT', retry_phase = $2, next_retry_at = clock_timestamp(),
          lease_until = null, lease_token = null where exchange_id = $1 and status = 'FAILED'`, [exchange.exchange_id, phase]);
        if (rowCount !== 1) fail("CONCURRENT_CHANGE");
        await client.query(`insert into integration.exchange_events(log_event_id, exchange_id, event_type, old_status, new_status, detail)
          values ($1, $2, 'OPERATOR_REQUEUE', 'FAILED', 'RETRY_WAIT', $3::jsonb)`, [randomUUID(), exchange.exchange_id, JSON.stringify({ phase, attempts_used: used, declared_budget: budget })]);
      }
    }
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
    return outcome;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function main(): Promise<void> {
  const [target, resultId, ...rest] = process.argv.slice(2);
  const budgetIndex = rest.indexOf("--budget");
  if ((target !== "lis" && target !== "middleware") || !resultId || budgetIndex < 0) {
    process.stderr.write("usage: requeue-failed.ts lis|middleware <result_id> --budget N [--confirm]\n"); process.exitCode = 2; return;
  }
  const url = process.env[target === "lis" ? "LIS_DATABASE_URL" : "MIDDLEWARE_DATABASE_URL"];
  if (!url) { process.stderr.write("DATABASE_URL_REQUIRED\n"); process.exitCode = 2; return; }
  const pool = new pg.Pool({ connectionString: url, max: 1 }); const client = await pool.connect();
  try {
    const outcome = await requeueFailed(client, target, resultId, Number(rest[budgetIndex + 1]), rest.includes("--confirm"));
    process.stdout.write(JSON.stringify(outcome) + "\n");
  } catch (error) { process.stderr.write(`REFUSED: ${(error as Error).message}\n`); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
}
if (process.argv[1]?.endsWith("requeue-failed.ts")) await main();
