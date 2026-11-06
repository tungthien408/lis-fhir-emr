/** Disposable PostgreSQL + existing cached backend image. Never attaches to Compose data. */
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const parent = path.join(root, 'frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04')
mkdirSync(parent, { recursive: true })
const evidence = mkdtempSync(path.join(parent, 'run-'))
const allSuites = ['test', 'test:middleware', 'test:emr', 'test:integration', 'test:e2e']
const selectedSuites = process.argv.find((arg) => arg.startsWith('--suites='))?.slice(9).split(',')
if (selectedSuites?.some((suite) => !allSuites.includes(suite))) throw new Error('Unsupported test suite')
const token = randomUUID(), dbName = 'phase23-db-' + token, appName = 'phase23-ui-' + token
const secrets = Object.fromEntries(['admin', 'lis', 'middleware', 'emr'].map((key) => [key, randomBytes(24).toString('hex')]))
const clean = (text) => Object.values(secrets).reduce((s, value) => s.replaceAll(value, '[redacted]'), text)
const report = { startedAt: new Date().toISOString(), evidence, isolation: { databaseContainer: dbName, storage: 'tmpfs, no Compose volumes', fixture: 'synthetic only' }, steps: [], completed: false }
let dbStarted = false, appStarted = false
async function command(executable, args, { env = {}, input, log, quiet = false, cwd = root } = {}) {
  let output = ''
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    const text = clean(chunk.toString()); output += text; if (!quiet) process.stdout.write(text)
  })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  if (log) writeFileSync(path.join(evidence, log), output)
  if (code !== 0) throw new Error('Command failed (' + code + '): ' + clean(output).slice(-3000))
  return output.trim()
}
const docker = (args, options = {}) => command('docker', args, { quiet: true, ...options })
const bindings = [...['src', 'tests'].flatMap((name) => ['--mount', 'type=bind,src=' + path.join(root, 'backend', name) + ',target=/app/' + name + ',readonly']), '--mount', 'type=bind,src=' + path.join(root, 'scripts') + ',target=/scripts,readonly', '--mount', 'type=bind,src=' + path.join(root, 'database') + ',target=/database,readonly']
const env = {}
for (const [name, role, password] of [['LIS', 'lis_app', secrets.lis], ['MIDDLEWARE', 'integration_app', secrets.middleware], ['EMR', 'emr_app', secrets.emr]]) {
  env[name + '_REPOSITORY_TEST_DATABASE_URL'] = 'postgresql://' + role + ':' + password + '@127.0.0.1:5432/dacn_db'
}
Object.assign(env, { LIS_REPOSITORY_TEST_DISPOSABLE_TOKEN: token, EMR_REPOSITORY_TEST_DISPOSABLE: '1', C4_DATABASE_ISOLATION_TOKEN: token, D3_DATABASE_ISOLATION_TOKEN: token,
  C4_EVIDENCE_PATH: '/evidence/c4.json', D3_EVIDENCE_PATH: '/evidence/d3.json', PHASE23_ISOLATION_TOKEN: token })
const containerArgs = () => ['--network', 'container:' + dbName, ...bindings,
  '--mount', 'type=bind,src=' + evidence + ',target=/evidence',
  ...Object.keys(env).flatMap((key) => ['-e', key]), 'lis-fhir-emr-backend:local']
async function step(name, action) {
  console.log('RUN: ' + name)
  const entry = { name, startedAt: new Date().toISOString() }; report.steps.push(entry)
  try { await action(); entry.result = 'PASS' } catch (error) { entry.result = 'FAIL'; entry.error = clean(String(error.stack ?? error)); throw error }
  finally { entry.finishedAt = new Date().toISOString() }
}
// This command can only reach the uniquely named database container owned by this run.
async function resetFixtureData() {
  await docker(['exec', '-i', dbName, 'psql', '-U', 'postgres', '-d', 'dacn_db', '-v', 'ON_ERROR_STOP=1'], {
    input: `DO $$ DECLARE targets text; BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO targets
      FROM pg_tables WHERE schemaname IN ('lis', 'integration', 'emr');
      IF targets IS NOT NULL THEN EXECUTE 'TRUNCATE ' || targets || ' RESTART IDENTITY CASCADE'; END IF;
    END $$;`,
  })
}
console.log('Evidence: ' + evidence)
try {
  // Bước Chrome cần frontend/apps/lis/dist; build trước để không chạy hết suite backend rồi mới dừng ở bước cuối.
  if (!process.argv.includes('--backend-only')) await step('Build LIS frontend', () => command('npm', ['run', 'build:lis'], { cwd: path.join(root, 'frontend'), log: 'build-lis.log', quiet: true }))
  if (process.argv.includes('--mock-only')) {
    await step('Chrome mock Publish', () => command(process.execPath, ['tests/browser-publish.mjs'], { cwd: path.join(root, 'frontend/apps/lis'),
      env: { LIS_EVIDENCE_DIR: path.join(evidence, 'chrome-mock') }, log: 'chrome-mock.log' }))
  } else {
    await docker(['run', '--detach', '--rm', '--pull=never', '--name', dbName, '--tmpfs', '/var/lib/postgresql/data',
      '-p', '127.0.0.1::33101', '-p', '127.0.0.1::33102', '-p', '127.0.0.1::33103',
      '-e', 'POSTGRES_DB=dacn_db', '-e', 'POSTGRES_PASSWORD', 'postgres:17'], { env: { POSTGRES_PASSWORD: secrets.admin } })
    dbStarted = true
    let ready = false
    for (let i = 0; i < 80; i++) { try { await docker(['exec', dbName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'dacn_db']); ready = true; break } catch { await delay(250) } }
    if (!ready) throw new Error('Disposable PostgreSQL not ready')
    for (const file of ['dacn_db_init_v2.sql', 'access_roles.sql']) await docker(['exec', '-i', dbName, 'psql', '-U', 'postgres', '-d', 'dacn_db', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(path.join(root, 'database', file), 'utf8') })
    await docker(['exec', '-i', dbName, 'psql', '-U', 'postgres', '-d', 'dacn_db', '-v', 'ON_ERROR_STOP=1'], {
      input: `ALTER ROLE lis_app PASSWORD '${secrets.lis}'; ALTER ROLE integration_app PASSWORD '${secrets.middleware}'; ALTER ROLE emr_app PASSWORD '${secrets.emr}'; COMMENT ON DATABASE dacn_db IS 'spp66-disposable:${token}';`,
    })
    if (!process.argv.includes('--browser-only')) {
      if (!selectedSuites) await step('Backend TypeScript', () => docker(['run', '--rm', '--pull=never', ...containerArgs(), 'npm', 'run', 'check'], { env, log: 'backend-typescript.log', quiet: false }))
      if (!selectedSuites) await step('Backend build', () => docker(['run', '--rm', '--pull=never', ...containerArgs(), 'npm', 'run', 'build'], { env, log: 'backend-build.log', quiet: false }))
      for (const suite of selectedSuites ?? allSuites) {
        await resetFixtureData()
        await step(suite, () => docker(['run', '--rm', '--pull=never', ...containerArgs(), 'npm', 'run', suite], { env, log: suite.replaceAll(':', '-') + '.log', quiet: false }))
      }
    }
    if (!process.argv.includes('--backend-only')) {
      await resetFixtureData()
      await docker(['run', '--detach', '--rm', '--pull=never', '--name', appName, ...containerArgs(), 'node', '--import', 'tsx', 'tests/e2e/publish-browser-server.ts'], { env })
      appStarted = true
      const ports = {}
      for (const [name, port] of [['lis', 33101], ['middleware', 33102], ['emr', 33103]]) {
        const text = await docker(['port', dbName, port + '/tcp']); const match = /^127\.0\.0\.1:(\d+)$/.exec(text)
        if (!match) throw new Error('Unverified disposable port'); ports[name] = 'http://127.0.0.1:' + match[1]
      }
      report.isolation.ports = ports
      let ready = false
      for (let i = 0; i < 80; i++) { try { const response = await fetch(ports.lis + '/ready', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break } } catch {} await delay(250) }
      if (!ready) { console.log(await docker(['logs', appName])); throw new Error('Isolated fixture API not ready') }
      await step('Chrome real UI -> isolated LIS/Dispatcher/Middleware/EMR', () => command(process.execPath, ['tests/browser-publish.mjs', '--real', ...(process.argv.includes('--dev') ? ['--dev'] : [])], {
        cwd: path.join(root, 'frontend/apps/lis'), env: { LIS_EVIDENCE_DIR: path.join(evidence, 'chrome-real'), LIS_TEST_TARGET: ports.lis, MIDDLEWARE_TEST_TARGET: ports.middleware, EMR_TEST_TARGET: ports.emr }, log: 'chrome-real.log' }))
      await docker(['exec', dbName, 'psql', '-U', 'postgres', '-d', 'dacn_db', '-c', "SELECT result_id,dispatch_status,dispatch_attempt_count FROM lis.publish_events ORDER BY result_id; SELECT source_result_id,status,verified_at FROM integration.exchange_transactions ORDER BY source_result_id; SELECT external_id,quantity::text,unit_text FROM emr.lab_results ORDER BY external_id;"], { log: 'isolated-database-final.log' })
    }
  }
  report.completed = true
} catch (error) { console.error(clean(String(error.stack ?? error))); process.exitCode = 1 }
finally {
  if (appStarted) { try { await docker(['logs', appName], { log: 'isolated-api.log' }) } finally { await docker(['stop', appName]) } }
  if (dbStarted) await docker(['stop', dbName])
  report.finishedAt = new Date().toISOString()
  writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
}
