/* Stage 1 browser-only response fixtures. Never executes or submits a benchmark. */
(function (global) {
  'use strict';
  const scenarios = ['success', 'rejection', 'failure', 'timeout', 'partial', 'cleanup_failure', 'sharing_failure'];
  const terminal = new Set(['completed', 'failed', 'partial', 'cancelled']);
  let pipelineSerial = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  function failure(code, message, status = 422) {
    return Object.assign(new Error(message), {simulated: true, code, status});
  }
  function requireSafePlan(value) {
    if (typeof value === 'string' && /-----BEGIN\s+(?:[A-Z ]*KEY|CERTIFICATE)-----/i.test(value)) {
      throw failure('UNSAFE_FIXTURE_INPUT', 'Certificate and private-key contents must never enter a workflow test plan.');
    }
    if (!value || typeof value !== 'object') return;
    for (const [name, entry] of Object.entries(value)) {
      if (name === 'secret_references') {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw failure('UNSAFE_FIXTURE_INPUT', 'Use credential references for workflow tests.');
        for (const reference of Object.values(entry)) {
          if (typeof reference !== 'string' || !/^(session|profile):[A-Za-z0-9_.:-]+$/.test(reference)) {
            throw failure('UNSAFE_FIXTURE_INPUT', 'Workflow tests accept credential references only.');
          }
        }
      } else if (/password|passwd|(?:^|_)pass(?:$|_)|token|authorization|cookie/i.test(name) && entry !== '' && entry != null) {
        throw failure('UNSAFE_FIXTURE_INPUT', 'Passwords and tokens must remain in the form, outside the simulation adapter.');
      } else {
        requireSafePlan(entry);
      }
    }
  }

  function createAdapter({scenario = 'success'} = {}) {
    if (!scenarios.includes(scenario)) throw failure('UNKNOWN_SCENARIO', 'Choose a supported workflow test outcome.');
    const records = new Map();
    const requests = new Map();
    const get = id => {
      if (!records.has(id)) throw failure('UNKNOWN_SIMULATION', 'This simulated Pipeline is unavailable.', 404);
      return records.get(id);
    };
    function sharing(record) {
      if (!record.request.operations.includes('run')) return {simulated: true, status: 'not_applicable', message: 'There is no benchmark result to share.'};
      if (!record.request.share_result) return {simulated: true, status: 'disabled', message: 'Sharing is disabled.'};
      const run = record.operations.find(operation => operation.operation === 'run');
      if (run.status === 'completed') {
        return scenario === 'sharing_failure'
          ? {simulated: true, status: 'failed', message: 'Simulated contribution failure. The successful benchmark result remains available. No GitHub changes were made.'}
          : {simulated: true, status: 'prepared', message: 'Simulated contribution preparation only. No GitHub changes or upstream pull request were made.'};
      }
      if (terminal.has(record.status)) return {simulated: true, status: 'not_applicable', message: 'No complete successful benchmark result is available for this simulated contribution.'};
      return {simulated: true, status: 'pending', message: 'Waiting for a successful simulated benchmark result.'};
    }
    function snapshot(record) {
      const active = record.operations.filter(operation => !['pending', 'skipped'].includes(operation.status));
      return copy({simulated: true, pipeline_id: record.id, status: record.status,
        operations: record.operations.map(operation => ({operation: operation.operation,
          status: operation.status, job_ids: ['pending', 'skipped'].includes(operation.status) ? [] : operation.jobs.map(job => job.job_id)})),
        job_ids: active.flatMap(operation => operation.jobs.map(job => job.job_id)), sharing: sharing(record)});
    }
    function finishOperation(record, operation) {
      const shouldFail = scenario === 'cleanup_failure' && operation.operation === 'deleteschema' ||
        scenario === 'failure' && operation.operation === (record.request.operations.includes('run') ? 'run' : record.request.operations[0]);
      const partial = scenario === 'partial' && operation.operation === 'run';
      operation.status = shouldFail || partial ? 'failed' : 'completed';
      operation.jobs.forEach((job, index) => {
        job.status = shouldFail || partial && index === operation.jobs.length - 1 ? 'failed' : 'completed';
      });
      if (shouldFail || partial) {
        record.status = partial ? 'partial' : 'failed';
        record.operations.filter(item => item.status === 'pending').forEach(item => {item.status = 'skipped';});
      } else if (record.operations.every(item => item.status === 'completed')) {
        record.status = 'completed';
      }
    }
    return {
      async submit(request) {
        requireSafePlan(request);
        if (request?.pipeline !== 'custom' || String(request.api_version) !== '1' ||
            !Array.isArray(request.operations) || !request.operations.length ||
            request.operations.some(operation => !['buildschema', 'checkschema', 'run', 'deleteschema'].includes(operation))) {
          throw failure('INVALID_FIXTURE_INPUT', 'A structured wizard plan is required for the workflow test.');
        }
        const fingerprint = JSON.stringify(request);
        if (request.request_id && requests.has(request.request_id)) {
          const previous = requests.get(request.request_id);
          if (previous.fingerprint !== fingerprint) throw failure('SIMULATED_CONFLICT', 'This request identity belongs to a different simulated plan.', 409);
          return snapshot(get(previous.id));
        }
        if (scenario === 'rejection') throw failure('SIMULATED_REJECTION', 'Simulated request rejection: the selected target is not authorised. Change the test outcome to try acceptance.');
        if (scenario === 'cleanup_failure' && !request.operations.includes('deleteschema')) {
          throw failure('SIMULATED_REJECTION', 'The cleanup-failure test requires an explicitly confirmed Delete Schema operation.');
        }
        if (scenario === 'partial' && (!request.operations.includes('run') || request.run_mode !== 'profile' || (request.profile?.concurrency?.length || 0) < 2)) {
          throw failure('SIMULATED_REJECTION', 'The partial-profile test requires a TPROC-C profile with at least two concurrency points.');
        }
        const sequence = ++pipelineSerial;
        const id = `SIM-PIPE-${sequence}`;
        let jobSerial = 0;
        const operations = request.operations.map(operation => {
          const concurrency = operation === 'run' && request.run_mode === 'profile'
            ? request.profile?.concurrency || [1] : [null];
          return {operation, status: 'pending', jobs: concurrency.map(point => ({
            simulated: true, job_id: `SIM-JOB-${sequence}-${++jobSerial}`, operation,
            status: 'pending', database: request.database, workload: request.workload,
            concurrency: point, metrics: null,
            message: 'Workflow simulation only. No database operation was executed and no performance was measured.'
          }))};
        });
        const record = {id, request: copy(request), status: 'queued', operations, polls: 0, timeoutShown: false};
        records.set(id, record);
        if (request.request_id) requests.set(request.request_id, {id, fingerprint});
        return snapshot(record);
      },
      async status(id) {
        const record = get(id);
        if (terminal.has(record.status)) return snapshot(record);
        record.polls += 1;
        if (scenario === 'timeout' && record.polls === 2 && !record.timeoutShown) {
          record.timeoutShown = true;
          throw failure('SIMULATED_TIMEOUT', 'Simulated status timeout. Retry status for the same Pipeline; do not submit another run.', 504);
        }
        if (record.polls === 1) return snapshot(record);
        const running = record.operations.find(operation => operation.status === 'running');
        if (running) finishOperation(record, running);
        else {
          const next = record.operations.find(operation => operation.status === 'pending');
          if (next) {
            record.status = 'running'; next.status = 'running';
            next.jobs.forEach(job => {job.status = 'running';});
          }
        }
        return snapshot(record);
      },
      async result(id) {
        const record = get(id);
        const run = record.operations.find(operation => operation.operation === 'run');
        const runJobs = run?.jobs.filter(job => job.status !== 'pending') || [];
        const benchmarkStatus = !runJobs.length ? 'not_run' : runJobs.some(job => job.status === 'running')
          ? 'running' : runJobs.some(job => job.status === 'cancelled') ? 'cancelled'
          : runJobs.every(job => job.status === 'completed') ? 'completed'
          : runJobs.some(job => job.status === 'completed') ? 'partial' : 'failed';
        return {...snapshot(record), benchmark_status: benchmarkStatus,
          jobs: copy(record.operations.filter(operation => !['pending', 'skipped'].includes(operation.status)).flatMap(operation => operation.jobs))};
      },
      async cancel(id) {
        const record = get(id);
        if (terminal.has(record.status)) return snapshot(record);
        record.status = 'cancelled';
        record.operations.forEach(operation => {
          if (operation.status === 'running') {
            operation.status = 'cancelled'; operation.jobs.forEach(job => {job.status = 'cancelled';});
          } else if (operation.status === 'pending') operation.status = 'skipped';
        });
        return snapshot(record);
      }
    };
  }
  const api = {createAdapter, scenarios};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global.document) global.HammerDBWizardMock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
