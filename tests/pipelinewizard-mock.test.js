// Browser-only fixtures: no native benchmark, HTTP request, or contribution.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAdapter} = require('../src/webservice/pipelinewizard-mock.js');
const plan = (changes = {}) => ({api_version: '1', pipeline: 'custom', database: 'pg', workload: 'C',
  target: {mode: 'existing', location: 'remote'}, operations: ['checkschema', 'run'],
  run_mode: 'single', vuset: {vu: 2}, share_result: true,
  diset: {connection: {pg_host: 'database.example', pg_port: 5432}},
  secret_references: {'tpcc.pg_pass': 'session:tpcc.pg_pass'}, ...changes});
async function finish(adapter, id) {
  const seen = [];
  for (let count = 0; count < 32; count++) {
    const status = await adapter.status(id); seen.push(status.status);
    if (['completed', 'failed', 'partial', 'cancelled'].includes(status.status)) return {status, seen, result: await adapter.result(id)};
  }
  throw new Error('Fixture did not terminate');
}

test('success tracks exact operation/job identities without fabricated measurements', async () => {
  const adapter = createAdapter();
  const accepted = await adapter.submit(plan());
  assert.match(accepted.pipeline_id, /^SIM-PIPE-/);
  const {seen, status, result} = await finish(adapter, accepted.pipeline_id);
  assert.ok(seen.includes('queued')); assert.ok(seen.includes('running'));
  assert.equal(status.status, 'completed'); assert.equal(result.benchmark_status, 'completed');
  assert.deepEqual(result.operations.map(item => item.operation), ['checkschema', 'run']);
  assert.deepEqual(result.job_ids, result.jobs.map(job => job.job_id));
  for (const job of result.jobs) {
    assert.equal(job.simulated, true); assert.match(job.job_id, /^SIM-JOB-/);
    assert.equal(job.metrics, null); assert.equal(job.nopm, undefined); assert.equal(job.tpm, undefined);
  }
  assert.equal(result.sharing.status, 'prepared'); assert.equal(result.sharing.simulated, true);
});

test('profile results preserve each requested concurrency point and supplied job identity', async () => {
  const adapter = createAdapter();
  const accepted = await adapter.submit(plan({run_mode: 'profile', profile: {concurrency: [1, 3, 6]}}));
  const {result} = await finish(adapter, accepted.pipeline_id);
  const run = result.operations.find(item => item.operation === 'run');
  const jobs = result.jobs.filter(job => job.operation === 'run');
  assert.deepEqual(jobs.map(job => job.concurrency), [1, 3, 6]);
  assert.deepEqual(run.job_ids, jobs.map(job => job.job_id));
});

test('rejection returns an explicit simulated error without a Pipeline', async () => {
  await assert.rejects(createAdapter({scenario: 'rejection'}).submit(plan()),
    error => error.simulated && error.status === 422 && error.code === 'SIMULATED_REJECTION');
});

test('operation failure keeps earlier successful jobs and skips later operations', async () => {
  const adapter = createAdapter({scenario: 'failure'});
  const accepted = await adapter.submit(plan({operations: ['checkschema', 'run', 'deleteschema']}));
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.status, 'failed'); assert.equal(result.benchmark_status, 'failed');
  assert.deepEqual(result.jobs.map(job => job.status), ['completed', 'failed']);
  assert.equal(result.operations[2].status, 'skipped');
  assert.equal(result.sharing.status, 'not_applicable');
});

test('cleanup failure preserves the successful benchmark and contribution status', async () => {
  const adapter = createAdapter({scenario: 'cleanup_failure'});
  const accepted = await adapter.submit(plan({operations: ['checkschema', 'run', 'deleteschema']}));
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.status, 'failed'); assert.equal(result.benchmark_status, 'completed');
  assert.equal(result.jobs.find(job => job.operation === 'run').status, 'completed');
  assert.equal(result.jobs.find(job => job.operation === 'deleteschema').status, 'failed');
  assert.equal(result.sharing.status, 'prepared');
  await assert.rejects(createAdapter({scenario: 'cleanup_failure'}).submit(plan()), /explicitly confirmed Delete Schema/);
});

test('sharing failure does not change a completed benchmark result', async () => {
  const adapter = createAdapter({scenario: 'sharing_failure'});
  const accepted = await adapter.submit(plan());
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.status, 'completed'); assert.equal(result.benchmark_status, 'completed');
  assert.equal(result.sharing.status, 'failed');
  assert.ok(result.jobs.every(job => job.status === 'completed'));
});

test('disabled sharing and schema-only plans never prepare contributions', async () => {
  for (const [request, expected] of [[plan({share_result: false}), 'disabled'], [plan({operations: ['checkschema']}), 'not_applicable']]) {
    const adapter = createAdapter({scenario: 'sharing_failure'});
    const accepted = await adapter.submit(request);
    const {result} = await finish(adapter, accepted.pipeline_id);
    assert.equal(result.sharing.status, expected);
  }
});

test('partial profiles retain successful and failed jobs without a complete-score claim', async () => {
  const adapter = createAdapter({scenario: 'partial'});
  const accepted = await adapter.submit(plan({run_mode: 'profile', profile: {concurrency: [1, 2, 4]}}));
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.status, 'partial'); assert.equal(result.benchmark_status, 'partial');
  assert.deepEqual(result.jobs.filter(job => job.operation === 'run').map(job => job.status), ['completed', 'completed', 'failed']);
  assert.equal(result.sharing.status, 'not_applicable');
  await assert.rejects(createAdapter({scenario: 'partial'}).submit(plan()), /at least two concurrency points/);
  await assert.rejects(createAdapter({scenario: 'partial'}).submit(plan({operations: ['checkschema']})), /partial-profile test/);
});

test('status timeout resumes the same identity without resubmitting work', async () => {
  const adapter = createAdapter({scenario: 'timeout'});
  const request = plan({request_id: 'test-timeout'});
  const accepted = await adapter.submit(request);
  await adapter.status(accepted.pipeline_id);
  await assert.rejects(adapter.status(accepted.pipeline_id), error => error.code === 'SIMULATED_TIMEOUT' && error.status === 504);
  const duplicate = await adapter.submit(request);
  assert.equal(duplicate.pipeline_id, accepted.pipeline_id);
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.pipeline_id, accepted.pipeline_id); assert.equal(result.status, 'completed');
});

test('cancellation is terminal and preserves already completed operations', async () => {
  const adapter = createAdapter();
  const accepted = await adapter.submit(plan());
  for (let index = 0; index < 4; index++) await adapter.status(accepted.pipeline_id);
  const cancelled = await adapter.cancel(accepted.pipeline_id);
  assert.equal(cancelled.status, 'cancelled');
  const result = await adapter.result(accepted.pipeline_id);
  assert.equal(result.jobs[0].status, 'completed');
  assert.equal(result.jobs[1].status, 'cancelled'); assert.equal(result.benchmark_status, 'cancelled');
  assert.equal((await adapter.status(accepted.pipeline_id)).status, 'cancelled');
});

test('retry identities reject changed plans and returned data cannot mutate fixture state', async () => {
  const adapter = createAdapter(); const request = plan({request_id: 'same-request'});
  const accepted = await adapter.submit(request);
  await assert.rejects(adapter.submit(plan({...request, workload: 'H'})), error => error.status === 409);
  request.database = 'other';
  const {result} = await finish(adapter, accepted.pipeline_id);
  assert.equal(result.jobs[0].database, 'pg');
  result.jobs[0].status = 'tampered';
  assert.equal((await adapter.result(accepted.pipeline_id)).jobs[0].status, 'completed');
});

test('raw credential values cannot enter the mock adapter', async () => {
  for (const request of [plan({diset: {tpcc: {pg_pass: 'SECRET_SENTINEL'}}}),
    plan({secret_references: {'tpcc.pg_pass': 'SECRET_SENTINEL'}}),
    plan({diset: {connection: {mysql_ssl_key: '-----BEGIN PRIVATE KEY-----SECRET_SENTINEL-----END PRIVATE KEY-----'}}})]) {
    await assert.rejects(createAdapter().submit(request), error => error.code === 'UNSAFE_FIXTURE_INPUT' && !error.message.includes('SECRET_SENTINEL'));
  }
});

test('separate adapters and repeated runs never reuse simulated identities', async () => {
  const first = await createAdapter().submit(plan());
  const second = await createAdapter().submit(plan());
  assert.notEqual(first.pipeline_id, second.pipeline_id);
});
