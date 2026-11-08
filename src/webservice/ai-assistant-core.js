/*
 * HammerDB AI Assistant: read-only job comparison helpers.
 * No credentials, model calls, benchmark execution or publishing.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HDBAssistantCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DATABASES = Object.freeze({pg:'PostgreSQL',maria:'MariaDB'});
  const SUBMIT_URL = 'https://tpc-council.github.io/hammerdb-results/submit.html';
  const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
  const BENCHMARKS = ['TPROC-C','TPROC-H'];
  const CONFIG_KEYS = ['warehouses','virtual_users','scale_factor','rampup_minutes','duration_minutes'];
  const SYSTEM_KEYS = ['cloud_instance','system_type','cpumodel','cpucount','memory','storage'];

  function database(value) {
    const name = String(value || '').trim().toLowerCase();
    if (['pg','postgres','postgresql'].includes(name)) return 'pg';
    if (['maria','mariadb'].includes(name)) return 'maria';
    return null;
  }
  function validJobId(value) { return typeof value === 'string' && JOB_ID.test(value); }
  function parseIntent(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length > 4000) throw Error('Enter a message of up to 4,000 characters.');
    const databases = [];
    for (const match of text.matchAll(/\b(postgresql|postgres|pg|mariadb|maria)\b/gi)) {
      const db = database(match[0]);
      if (db && !databases.includes(db)) databases.push(db);
    }
    const ids = [...text.matchAll(/\b([A-Fa-f0-9]{16,40})\b/g)]
      .map(match => match[1]).filter(validJobId).slice(0,2);
    const benchmark = /\btproc[\s-]*h\b/i.test(text) ? 'TPROC-H' : 'TPROC-C';
    const wantsRun=/\b(run|start|profile|benchmark|execute)\b/i.test(text);
    const wantsCompare=/\b(compare|comparison|versus|vs\.?|against|difference|differ|better)\b/i.test(text);
    if (wantsRun && ids.length<2)
      return {kind:'profile',databases:databases.length?databases:['pg','maria'],benchmark};
    if (wantsCompare || ids.length===2)
      return {kind:'compare',databases:databases.length?databases:['pg','maria'],ids,benchmark};
    if (/\b(share|submit|publish|github|leaderboard|contribute)\b/i.test(text))
      return {kind:'share',databases,benchmark};
    return {kind:'help',databases,benchmark};
  }
  function finite(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function normalizeJobList(response) {
    if (!response || !Array.isArray(response.jobs)) throw Error('Invalid job list response.');
    return response.jobs.slice(0,100).map(item => {
      const db=database(item.database),benchmark=String(item.benchmark||'').replace(/^TPC-/,'TPROC-');
      if (!validJobId(item.jobid) || !db || !BENCHMARKS.includes(benchmark)) return null;
      return {jobid:item.jobid,database:db,benchmark,timestamp:String(item.timestamp||'').slice(0,40)};
    }).filter(Boolean);
  }
  function summarizeJob(id,artifact) {
    if (!validJobId(id)) throw Error('Invalid job ID.');
    if (!artifact || artifact.schema!=='hammerdb-job-report-v1' || !artifact.job || !artifact.result)
      throw Error('Not a supported HammerDB result artifact.');
    const job=artifact.job, result=artifact.result;
    if (job.jobid!==id) throw Error('Job ID mismatch in artifact.');
    const db=database(job.database);
    if (!db) throw Error('Only PostgreSQL and MariaDB are supported.');
    if (!BENCHMARKS.includes(job.benchmark)) throw Error('Unsupported workload.');
    const metrics=[];
    if (job.benchmark==='TPROC-C' && result.type==='tproc_c_result') {
      for (const [field,label] of [['nopm','NOPM'],['tpm','TPM']]) {
        const value=finite(result[field]);
        if (value!==null) metrics.push({field,label,value,unit:'per minute',higherIsBetter:true});
      }
    } else if (job.benchmark==='TPROC-H' && result.type==='tproc_h_result') {
      for (const [field,label] of [['geomean_seconds','Geometric mean'],['total_query_time_seconds','Total query time']]) {
        const value=finite(result[field]);
        if (value!==null) metrics.push({field,label,value,unit:'seconds',higherIsBetter:false});
      }
    } else throw Error('Result type does not match workload.');
    if (!metrics.length) throw Error('Job has no completed numeric result.');
    const config={},system={},latency={};
    for (const key of CONFIG_KEYS) {
      if (artifact.benchmark_config && Object.prototype.hasOwnProperty.call(artifact.benchmark_config,key))
        config[key]=String(artifact.benchmark_config[key]).slice(0,200);
    }
    for (const key of SYSTEM_KEYS) {
      const value=artifact.system && artifact.system[key];
      if (typeof value==='string' || typeof value==='number') system[key]=String(value).slice(0,300);
    }
    if (job.benchmark==='TPROC-C' && artifact.response_times && Array.isArray(artifact.response_times.rows)) {
      for (const row of artifact.response_times.rows.slice(0,40)) {
        const name=String(row.name||'').toUpperCase();
        if (!/^[A-Z0-9_]{1,30}$/.test(name)) continue;
        const p95=finite(row.p95_ms),p99=finite(row.p99_ms);
        if (p95!==null || p99!==null) latency[name]={p95_ms:p95,p99_ms:p99};
      }
    }
    return {jobid:id,database:db,benchmark:job.benchmark,release:String(job.release||'').slice(0,100),
      hdb_version:String(job.hdb_version||'').slice(0,100),timestamp:String(job.timestamp||'').slice(0,60),
      config,system,metrics,latency};
  }
  function compareJobs(pg,maria) {
    if (!pg || !maria || pg.database!=='pg' || maria.database!=='maria')
      throw Error('Select a PostgreSQL result and a MariaDB result.');
    if (pg.jobid===maria.jobid) throw Error('Select different jobs.');
    if (pg.benchmark!==maria.benchmark) throw Error('Cannot compare different workloads directly.');
    const rows=[];
    for (const a of pg.metrics) {
      const b=maria.metrics.find(item=>item.field===a.field);
      if (!b) continue;
      rows.push({label:a.label,field:a.field,pg:a.value,maria:b.value,
        percentage:a.value===0?null:((b.value-a.value)/a.value)*100,unit:a.unit,higherIsBetter:a.higherIsBetter});
    }
    if (!rows.length) throw Error('No shared numeric result metrics.');
    const caveats=[];
    for (const key of CONFIG_KEYS) {
      const a=pg.config[key],b=maria.config[key];
      if (a==null && b==null) continue;
      if (a==null || b==null) caveats.push(key+': not recorded for both');
      else if (a!==b) caveats.push(key+': values differ');
    }
    for (const key of SYSTEM_KEYS) {
      const a=pg.system[key],b=maria.system[key];
      if (a && b && a!==b) caveats.push('System '+key+': values differ');
      else if (!!a!==!!b) caveats.push('System '+key+': not recorded for both');
    }
    if (pg.hdb_version && maria.hdb_version && pg.hdb_version!==maria.hdb_version)
      caveats.push('HammerDB version differs');
    const latency=[];
    for (const [name,a] of Object.entries(pg.latency)) {
      const b=maria.latency[name];
      if (b) latency.push({name,pgP95:a.p95_ms,mariaP95:b.p95_ms,pgP99:a.p99_ms,mariaP99:b.p99_ms});
    }
    return {pg,maria,rows,caveats,latency,
      note:'HammerDB results are unaudited and do not establish causality. Check workload and system settings before drawing conclusions.'};
  }
  function pipelineUrl(db,benchmark) {
    if (!Object.prototype.hasOwnProperty.call(DATABASES,db) || !BENCHMARKS.includes(benchmark))
      throw Error('Unsupported profile.');
    return 'pipelines?db='+encodeURIComponent(db)+'&pipeline=profile&workload='+
      (benchmark==='TPROC-H'?'H':'C'); // No action=run.
  }
  function artifactUrl(id) {
    if (!validJobId(id)) throw Error('Invalid job ID.');
    return 'jobs?jobid='+encodeURIComponent(id)+'&summaryjson';
  }
  return Object.freeze({DATABASES,SUBMIT_URL,validJobId,parseIntent,normalizeJobList,
    summarizeJob,compareJobs,pipelineUrl,artifactUrl});
});