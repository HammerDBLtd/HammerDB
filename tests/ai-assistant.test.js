'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../src/webservice/ai-assistant-core.js');
const PG='ABCDEF1234567890';
const MARIA='ABCDEF1234567891';

function sample(id,db,nopm,config={warehouses:70,virtual_users:8,rampup_minutes:2,duration_minutes:5}) {
  return {schema:'hammerdb-job-report-v1',
    job:{jobid:id,database:db,benchmark:'TPROC-C',release:'18.6',hdb_version:'v6.1.1',timestamp:'2026-01-01'},
    benchmark_config:config,
    system:{hostname:'private-hostname',cpumodel:'Example CPU',cpucount:8,cloud_instance:'m7i.2xlarge'},
    result:{type:'tproc_c_result',nopm,tpm:nopm*2},
    response_times:{rows:[{name:'NEWORD',p95_ms:1.5,p99_ms:2.5}]}
  };
}
test('natural language recognizes PostgreSQL vs MariaDB comparison',()=>{
  const r=core.parseIntent('Please compare postgres to mariadb');
  assert.equal(r.kind,'compare'); assert.deepEqual(r.databases,['pg','maria']);
});
test('run prompts only prepare the existing Pipelines page',()=>{
  assert.equal(core.parseIntent('run a postgres profile').kind,'profile');
  const url=core.pipelineUrl('pg','TPROC-C');
  assert.match(url,/pipelines\?db=pg&pipeline=profile/);
  assert.doesNotMatch(url,/action=run/);
});
test('job index rejects unknown database and invalid ID',()=>{
  const rows=core.normalizeJobList({jobs:[
    {jobid:PG,database:'PostgreSQL',benchmark:'TPC-C',timestamp:'2026-01-01'},
    {jobid:MARIA,database:'other',benchmark:'TPROC-C',timestamp:'2026-01-01'},
    {jobid:'bad id; DROP TABLE JOBMAIN',database:'maria',benchmark:'TPROC-C'}
  ]});
  assert.deepEqual(rows.map(r=>r.jobid),[PG]);
});
test('real-shaped TPROC-C report parses throughput and response-time percentiles',()=>{
  const result=core.summarizeJob(PG,sample(PG,'PostgreSQL',400));
  assert.equal(result.metrics[0].value,400);
  assert.equal(result.latency.NEWORD.p99_ms,2.5);
});
test('numeric comparison uses measured NOPM, warning on hardware mismatch',()=>{
  const pg=core.summarizeJob(PG,sample(PG,'pg',400));
  const modified=sample(MARIA,'MariaDB',300,{warehouses:100,virtual_users:8,rampup_minutes:2,duration_minutes:5});
  modified.system.cpumodel='Different CPU';
  const maria=core.summarizeJob(MARIA,modified);
  const comparison=core.compareJobs(pg,maria);
  assert.equal(comparison.rows[0].percentage,-25);
  assert.ok(comparison.caveats.some(item=>item.includes('warehouses')));
  assert.ok(comparison.caveats.some(item=>item.includes('cpumodel')));
});
test('do not fabricate measurements for unfinished jobs',()=>{
  const x=sample(PG,'PostgreSQL',400); delete x.result.nopm;delete x.result.tpm;
  assert.throws(()=>core.summarizeJob(PG,x),/no completed numeric/);
});
test('artifact identity and workload must match',()=>{
  assert.throws(()=>core.summarizeJob(MARIA,sample(PG,'PostgreSQL',400)),/ID mismatch/);
  const a=sample(PG,'PostgreSQL',400);a.job.benchmark='TPROC-H';
  assert.throws(()=>core.summarizeJob(PG,a),/type does not match/);
});
test('do not compare unlike workloads',()=>{
  const pg=core.summarizeJob(PG,sample(PG,'PostgreSQL',400));
  const mariadb=sample(MARIA,'MariaDB',300);
  mariadb.job.benchmark='TPROC-H';
  mariadb.result={type:'tproc_h_result',geomean_seconds:10};
  const maria=core.summarizeJob(MARIA,mariadb);
  assert.throws(()=>core.compareJobs(pg,maria),/different workloads/);
});
test('published artifacts may contain hostnames, but summary excludes them',()=>{
  const report=core.summarizeJob(PG,sample(PG,'PostgreSQL',400));
  assert.equal(JSON.stringify(report).includes('private-hostname'),false);
});
test('syntax-check both client-side scripts without executing browser code',()=>{
  for(const filename of ['ai-assistant-core.js','ai-assistant.js']) {
    const content=fs.readFileSync(path.join(__dirname,'..','src','webservice',filename),'utf8');
    assert.doesNotThrow(()=>new vm.Script(content,{filename}));
  }
});