// Stage 1 only: mocked metadata and pure request planning; no CI submissions.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const wizard = require('../src/webservice/pipelinewizard.js');

const field = (name, group, value, role, extra = {}) => ({
  name, group, label: name, default: value, type: 'text', required: true,
  ...(role ? {role} : {}), ...extra
});

// Representative backend metadata. Names match config/*.xml; Tcl tests exercise
// the real XML adapter separately. Nothing in this fixture connects to a DB.
function metadata() {
  const databaseNames = {ora: 'Oracle', mssqls: 'SQL Server', db2: 'Db2',
    mysql: 'MySQL', maria: 'MariaDB', pg: 'PostgreSQL', vsql: 'VillageSQL'};
  const databases = Object.entries(databaseNames).map(([id, label]) => {
    const host = id === 'ora' ? 'instance' : id === 'mssqls' ? 'mssqls_linux_server' :
      id === 'db2' ? 'db2_def_dbase' : `${id}_host`;
    const port = id === 'mssqls' ? 'mssqls_port' : `${id}_port`;
    const schemaName = workload => id === 'ora' ? `tpc${workload === 'C' ? 'c' : 'h'}_user` :
      `${id}_${workload === 'H' ? 'tpch_' : ''}dbase`;
    const workloads = {};
    for (const workload of ['C', 'H']) {
      const group = workload === 'C' ? 'tpcc' : 'tpch';
      const connection = [field(host, 'connection', 'benchmark.example.test', 'endpoint')];
      if (!['ora', 'db2'].includes(id)) connection.push(field(port, 'connection', id === 'pg' ? 5432 : 3306,
        'port', {type: 'number', min: 1, max: 65535}));
      if (['mysql', 'maria', 'vsql'].includes(id)) connection.push(
        field(`${id}_socket`, 'connection', '/tmp/database.sock', 'socket', {required: false, local_only: true}));
      if (id === 'mssqls') connection.push(
        field('mssqls_linux_authent', 'connection', 'sql', 'authentication',
          {type: 'select', options: ['windows', 'sql', 'entra']}),
        field('mssqls_uid', 'connection', 'benchmark_user', 'username',
          {condition: {name: 'mssqls_linux_authent', values: ['sql']}}));
      connection.push(field(schemaName(workload), group, workload === 'C' ? 'tpcc' : 'tpch', 'database'));
      const settings = [
        field(id === 'ora' ? (workload === 'C' ? 'count_ware' : 'scale_fact') :
          `${id}_${workload === 'C' ? 'count_ware' : 'scale_fact'}`, group, 1, 'scale', {type: 'number', min: 1}),
        field(id === 'ora' ? (workload === 'C' ? 'num_vu' : 'num_tpch_threads') :
          `${id}_${workload === 'C' ? 'num_vu' : 'num_tpch_threads'}`, group, 1, 'builder_vu', {type: 'number', min: 1})
      ];
      if (workload === 'C') settings.push(
        field(id === 'ora' ? 'ora_driver' : `${id}_driver`, group, 'timed', 'driver',
          {type: 'select', options: ['timed', 'test']}),
        field(id === 'ora' ? 'rampup' : `${id}_rampup`, group, 2, 'rampup', {type: 'number', min: 0, condition: {name: id === 'ora' ? 'ora_driver' : `${id}_driver`, values: ['timed']}}),
        field(id === 'ora' ? 'duration' : `${id}_duration`, group, 5, 'duration', {type: 'number', min: 1, condition: {name: id === 'ora' ? 'ora_driver' : `${id}_driver`, values: ['timed']}})
      );
      else settings.push(
        field(id === 'ora' ? 'total_querysets' : `${id}_total_querysets`, group, 1, 'querysets', {type: 'number'}),
        field(id === 'ora' ? 'refresh_on' : `${id}_refresh_on`, group, false, 'advanced', {type: 'checkbox', advanced: true})
      );
      workloads[workload] = {connection, settings};
    }
    return {id, label, library_status: 'available', workloads};
  });
  return {api_version: '1', preview: true, custom_execution: false, databases,
    generic: {virtual_users: 1, autopilot_sequence: [1, 2, 4, 8, 12, 16, 20, 24], avu_min: 1, avu_max: null}};
}

function state(overrides = {}) {
  return {location: 'remote', target_mode: 'existing', database: 'pg', workload: 'C',
    connection_profile: 'rds-benchmark', values: {}, workflow: 'benchmark', operations: [],
    build_schema: false, confirm_build: false, confirm_delete: false, delete_confirmation: '',
    driver_vu: 2, avu_mode: 'auto', max_avu: 24, run_mode: 'single', profile: '1 2 4 8',
    share_result: true, ...overrides};
}

for (const database of ['ora', 'mssqls', 'db2', 'mysql', 'maria', 'pg', 'vsql']) {
  for (const workload of ['C', 'H']) {
    test(`${database} TPROC-${workload} produces a structured existing-endpoint plan`, () => {
      const request = wizard.buildRequest(state({database, workload}), metadata());
      assert.equal(request.api_version, '1');
      assert.equal(request.pipeline, 'custom');
      assert.equal(request.database, database);
      assert.equal(request.workload, workload);
      assert.equal(request.target.mode, 'existing');
      assert.deepEqual(request.operations, ['checkschema', 'run']);
      assert.ok(request.diset[workload === 'C' ? 'tpcc' : 'tpch']);
      assert.equal(request.diset[workload === 'C' ? 'tpch' : 'tpcc'], undefined);
      assert.equal(request.share_result, true);
      assert.equal(request.ref, undefined, 'existing endpoints must not acquire source refs');
    });
  }
}

test('local and remote location do not change the existing target mode', () => {
  for (const location of ['local', 'remote']) {
    const request = wizard.buildRequest(state({location}), metadata());
    assert.equal(request.target.location, location);
    assert.equal(request.target.mode, 'existing');
    assert.equal(request.target.connection_profile, 'rds-benchmark');
  }
});

test('source provisioning hands off to the established Pipeline instead of generating custom work', () => {
  assert.throws(() => wizard.buildRequest(state({location: 'local', target_mode: 'source'}), metadata()));
  assert.throws(() => wizard.buildRequest(state({location: 'remote', target_mode: 'source'}), metadata()));
});

test('simple benchmark never builds or deletes a schema implicitly', () => {
  const request = wizard.buildRequest(state(), metadata());
  assert.deepEqual(request.operations, ['checkschema', 'run']);
  assert.ok(!request.operations.includes('deleteschema'));
  assert.ok(!request.operations.includes('buildschema'));
});

test('schema creation requires explicit authority in either workflow', () => {
  for (const overrides of [{build_schema: true}, {workflow: 'operations', operations: ['buildschema']}]) {
    assert.throws(() => wizard.buildRequest(state(overrides), metadata()));
    const request = wizard.buildRequest(state({...overrides, confirm_build: true}), metadata());
    assert.ok(request.operations.includes('buildschema'));
  }
});

test('individual operations use the shared request and schema deletion is bound to the exact target', () => {
  const candidate = state({workflow: 'operations', operations: ['deleteschema']});
  assert.throws(() => wizard.buildRequest(candidate, metadata()));
  const confirmation = wizard.deletionTarget(candidate, metadata());
  const confirmed = {...candidate, confirm_delete: true, delete_confirmation: confirmation};
  assert.deepEqual(wizard.buildRequest(confirmed, metadata()).operations, ['deleteschema']);
  assert.throws(() => wizard.buildRequest({...confirmed,
    values: {pg_host: 'another.example.test'}}, metadata()));
  assert.throws(() => wizard.buildRequest({...confirmed,
    values: {pg_dbase: 'another_schema'}}, metadata()));
  assert.throws(() => wizard.buildRequest({...confirmed,
    values: {pg_port: 5544}}, metadata()));
  assert.throws(() => wizard.buildRequest({...confirmed, connection_profile: 'another-profile'}, metadata()));
});

test('deletion authority for a local MySQL endpoint includes its exact socket', () => {
  const candidate = state({database: 'mysql', location: 'local', workflow: 'operations',
    operations: ['deleteschema'], confirm_delete: true});
  candidate.delete_confirmation = wizard.deletionTarget(candidate, metadata());
  assert.deepEqual(wizard.buildRequest(candidate, metadata()).operations, ['deleteschema']);
  assert.throws(() => wizard.buildRequest({...candidate, values: {mysql_socket: '/tmp/another.sock'}}, metadata()));
});

test('empty operations and unrecognised executable operations are rejected', () => {
  for (const operations of [[], ['exec'], ['run', 'run'], ['checkschema', 'eval']]) {
    assert.throws(() => wizard.buildRequest(state({workflow: 'operations', operations}), metadata()));
  }
});

for (const operation of ['buildschema', 'checkschema', 'run', 'deleteschema']) {
  test(`the individual ${operation} operation stays separate from implicit benchmark work`, () => {
    const candidate = state({workflow: 'operations', operations: [operation], confirm_build: true,
      confirm_delete: true});
    candidate.delete_confirmation = wizard.deletionTarget(candidate, metadata());
    const request = wizard.buildRequest(candidate, metadata());
    assert.deepEqual(request.operations, [operation]);
    assert.equal(Boolean(request.vuset), operation === 'run');
    assert.equal(Boolean(request.max_avu), operation === 'run');
  });
}

test('a timed test-driver switch omits disabled timing fields instead of sending stale settings', () => {
  const request = wizard.buildRequest(state({values: {pg_driver: 'test', pg_rampup: 20,
    pg_duration: 30}}), metadata());
  assert.equal(request.diset.tpcc.pg_driver, 'test');
  assert.equal(request.diset.tpcc.pg_rampup, undefined);
  assert.equal(request.diset.tpcc.pg_duration, undefined);
});

test('SQL Server authentication controls whether SQL username is an active request field', () => {
  const windowsAuth = wizard.buildRequest(state({database: 'mssqls', values: {
    mssqls_linux_authent: 'windows', mssqls_uid: 'stale-user'}}), metadata());
  assert.equal(windowsAuth.diset.connection.mssqls_linux_authent, 'windows');
  assert.equal(windowsAuth.diset.connection.mssqls_uid, undefined);
  const sqlAuth = wizard.buildRequest(state({database: 'mssqls', values: {
    mssqls_linux_authent: 'sql', mssqls_uid: 'sql-user'}}), metadata());
  assert.equal(sqlAuth.diset.connection.mssqls_uid, 'sql-user');
});

test('remote endpoints omit local-only sockets and local endpoints preserve them', () => {
  const remote = wizard.buildRequest(state({database: 'mysql', location: 'remote'}), metadata());
  assert.equal(remote.diset.connection.mysql_socket, undefined);
  const local = wizard.buildRequest(state({database: 'mysql', location: 'local'}), metadata());
  assert.equal(local.diset.connection.mysql_socket, '/tmp/database.sock');
});

test('schema builder concurrency is validated separately against warehouse count', () => {
  assert.throws(() => wizard.buildRequest(state({build_schema: true, confirm_build: true,
    values: {pg_count_ware: 1, pg_num_vu: 2}}), metadata()));
});

test('manual Max AVU remains distinct from driver and schema-builder virtual users', () => {
  const request = wizard.buildRequest(state({avu_mode: 'manual', max_avu: 16, driver_vu: 4,
    build_schema: true, confirm_build: true, values: {pg_num_vu: 2, pg_count_ware: 2}}), metadata());
  assert.equal(request.vuset.vu, 4);
  assert.equal(request.diset.tpcc.pg_num_vu, 2);
  assert.equal(request.max_avu.mode, 'manual');
  assert.equal(request.max_avu.maximum, 16);
});

test('Auto Max AVU does not invent a single optimum or backend maximum', () => {
  const request = wizard.buildRequest(state({max_avu: 999999, profile: '1 3 9'}), metadata());
  assert.equal(request.max_avu.mode, 'auto');
  assert.notEqual(request.max_avu.maximum, 999999);
  assert.deepEqual(request.max_avu.autopilot_sequence, metadata().generic.autopilot_sequence,
    'Single+Auto uses existing Autopilot configuration, not stale hidden profile input');
});

test('TPROC-H Auto does not borrow transactional Autopilot concurrency', () => {
  const request = wizard.buildRequest(state({workload: 'H'}), metadata());
  assert.deepEqual(request.max_avu, {mode: 'auto'});
  assert.equal(request.profile, undefined);
});

test('schema-only operations omit analytic driver and refresh settings', () => {
  const candidate = state({workload: 'H', workflow: 'operations', operations: ['deleteschema'],
    confirm_delete: true, values: {pg_total_querysets: 10, pg_refresh_on: true}});
  candidate.delete_confirmation = wizard.deletionTarget(candidate, metadata());
  const request = wizard.buildRequest(candidate, metadata());
  assert.equal(request.diset.tpch.pg_total_querysets, undefined);
  assert.equal(request.diset.tpch.pg_refresh_on, undefined);
  assert.equal(request.run_mode, undefined);
});

test('increasing TPROC-C profiles preserve their concurrency points', () => {
  const request = wizard.buildRequest(state({run_mode: 'profile', profile: '1 2 4 8'}), metadata());
  assert.equal(request.run_mode, 'profile');
  assert.deepEqual(request.profile.concurrency, [1, 2, 4, 8]);
});

test('unsupported TPROC-H profiles and non-increasing profiles are rejected', () => {
  for (const overrides of [{workload: 'H', run_mode: 'profile'},
    {run_mode: 'profile', profile: '1 4 2'}, {run_mode: 'profile', profile: '1 2 2'},
    {run_mode: 'profile', profile: '1; exec whoami'}]) {
    assert.throws(() => wizard.buildRequest(state(overrides), metadata()));
  }
});

test('manual concurrency obeys real metadata limits and rejects non-integers', () => {
  const capped = metadata(); capped.generic.avu_max = 32;
  for (const max_avu of [0, -1, 1.5, '8;exec id', 33]) {
    assert.throws(() => wizard.buildRequest(state({avu_mode: 'manual', max_avu}), capped));
  }
});

test('sharing can be disabled without altering benchmark operations', () => {
  const request = wizard.buildRequest(state({share_result: false}), metadata());
  assert.equal(request.share_result, false);
  assert.deepEqual(request.operations, ['checkschema', 'run']);
});

test('native connection names and explicitly supplied endpoint settings are retained', () => {
  const request = wizard.buildRequest(state({values: {pg_host: 'pg.example.test',
    pg_port: 5544, pg_dbase: 'benchmark'}}), metadata());
  assert.equal(request.diset.connection.pg_host, 'pg.example.test');
  assert.equal(request.diset.connection.pg_port, 5544);
  assert.equal(request.diset.tpcc.pg_dbase, 'benchmark');
  assert.equal(request.diset.connection.host, undefined);
});

test('invalid database, workload, connection profile and required fields are rejected', () => {
  for (const overrides of [{database: 'sqlite'}, {workload: 'X'}, {connection_profile: ''},
    {connection_profile: '../etc/passwd'}, {values: {pg_host: ''}}, {values: {pg_port: 70000}},
    {values: {pg_count_ware: -1}}, {values: {pg_driver: 'untrusted'}}]) {
    assert.throws(() => wizard.buildRequest(state(overrides), metadata()));
  }
});

test('connection fields reject command syntax, embedded credentials and control characters', () => {
  for (const pg_host of ['host;exec id', '[exec id]', 'postgres://user:password@host', 'host\nnext']) {
    assert.throws(() => wizard.buildRequest(state({values: {pg_host}}), metadata()));
  }
});

test('stale fields from a previous database or workload never enter a request', () => {
  const request = wizard.buildRequest(state({workload: 'H', values: {
    pg_count_ware: 10, pg_rampup: 5, mysql_host: 'old.example.test',
    pg_tpch_dbase: 'analytics'}}), metadata());
  assert.equal(request.diset.tpch.pg_tpch_dbase, 'analytics');
  assert.ok(!JSON.stringify(request).includes('old.example.test'));
  assert.ok(!JSON.stringify(request).includes('pg_count_ware'));
  assert.ok(!JSON.stringify(request).includes('pg_rampup'));
});

test('passwords or arbitrary unknown settings cannot leak into planned requests', () => {
  let request;
  try {
    request = wizard.buildRequest(state({values: {pg_pass: 'DO_NOT_LEAK',
      unknown_shell_command: 'DO_NOT_EXECUTE'}}), metadata());
  } catch (error) {
    assert.ok(!error.message.includes('DO_NOT_LEAK'));
    return;
  }
  assert.ok(!JSON.stringify(request).includes('DO_NOT_LEAK'));
  assert.ok(!JSON.stringify(request).includes('DO_NOT_EXECUTE'));
});

test('request summaries redact nested sensitive values and leave canonical request untouched', () => {
  const request = {target: {connection_profile: 'profile', password: 'PASSWORD_SENTINEL'},
    diset: {connection: {pg_pass: 'PASS_SENTINEL', access_token: 'TOKEN_SENTINEL',
      ssl_key: 'SSL_KEY_SENTINEL', private_key: 'PRIVATE_KEY_SENTINEL'}},
    operations: ['run']};
  const summary = wizard.reviewRequest(request);
  const rendered = JSON.stringify(summary);
  for (const secret of ['PASSWORD_SENTINEL', 'PASS_SENTINEL', 'TOKEN_SENTINEL', 'SSL_KEY_SENTINEL', 'PRIVATE_KEY_SENTINEL'])
    assert.ok(!rendered.includes(secret));
  assert.equal(request.target.password, 'PASSWORD_SENTINEL');
});

module.exports = {metadata, state};
