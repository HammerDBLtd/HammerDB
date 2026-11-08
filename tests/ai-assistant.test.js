'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../src/webservice/ai-assistant-core.js');

const IDS=['AA001122334455667788','BB001122334455667788','CC001122334455667788','DD001122334455667788'];
const DBS=['maria','pg','mysql','vsql'];

function artifact(db,id,nopm,config={warehouses:70,virtual_users:8,duration_minutes:5,rampup_minutes:2}){
  return {schema:'hammerdb-job-report-v1',
    job:{jobid:id,database:core.DATABASES[db],benchmark:'TPROC-C',
      release:'test-version',timestamp:'2026-01-01',hdb_version:'v6.1.1'},
    result:{type:'tproc_c_result',nopm,tpm:nopm*2},
    benchmark_config:config,
    system:{hostname:'do-not-export-host',cloud_instance:'AWS m7i.2xlarge',cpucount:8},
    response_times:{rows:[{name:'NEWORD',p95_ms:1.2,p99_ms:2.1}]}
  };
}
function summaries(){
  return DBS.map((db,i)=>core.summarizeJob(IDS[i],artifact(db,IDS[i],100*(i+1))));
}
test('four databases are extracted in user order',()=>{
  const x=core.parseIntent('Run profiles on MariaDB, PostgreSQL, MySQL and VillageSQL, then compare');
  assert.equal(x.kind,'profile');
  assert.deepEqual(x.databases,DBS);
  assert.equal(x.compareAfter,true);
  assert.equal(x.io_intensive,0);
});
test('MySQL exact requested ref, workload and I/O flag',()=>{
  const command='MySQL 26.10.0 — TPROC-C PROFILE, 1 socket (96 cores), I/O-intensive OFF: cipush refs/tags/mysql-26.10.0 profile C mysql 0';
  const x=core.parseIntent(command);
  assert.deepEqual(x.databases,['mysql']);
  assert.equal(x.refs.mysql,'refs/tags/mysql-26.10.0');
  assert.deepEqual(core.planProfile('mysql',x.refs.mysql),{
    ref:'refs/tags/mysql-26.10.0',pipeline:'profile',workload:'C',
    database:'mysql',io_intensive:0
  });
});
test('VillageSQL exact requested ref and follow-up "now village"',()=>{
  const command='now village VillageSQL 0.0.7 — TPROC-C PROFILE: cipush refs/tags/release/0.0.7 profile C vsql 0';
  const x=core.parseIntent(command);
  assert.equal(x.kind,'profile');
  assert.deepEqual(x.databases,['vsql']);
  assert.equal(x.refs.vsql,'refs/tags/release/0.0.7');
  assert.equal(core.parseIntent('now village').databases[0],'vsql');
});
test('no guessed MariaDB or PostgreSQL ref, and unsafe refs are rejected',()=>{
  const x=core.parseIntent('Run MariaDB and Postgres then compare');
  assert.deepEqual(x.refs,{});
  assert.equal(core.validRef('refs/tags/mysql-26.10.0'),true);
  assert.equal(core.validRef('refs/tags/../../something'),false);
  assert.equal(core.validRef('refs/tags/-danger'),false);
  assert.throws(()=>core.planProfile('pg','refs/tags/../bad'));
  assert.throws(()=>core.planProfile('mysql','refs/tags/mysql-26.10.0',5));
});
test('existing pipeline review URL never runs a benchmark',()=>{
  const url=core.pipelineUrl('vsql','refs/tags/release/0.0.7',0);
  const parsed=new URL('http://localhost:8080/'+url);
  assert.equal(parsed.searchParams.get('db'),'vsql');
  assert.equal(parsed.searchParams.get('ref_custom'),'refs/tags/release/0.0.7');
  assert.equal(parsed.searchParams.get('pipeline'),'profile');
  assert.equal(parsed.searchParams.has('action'),false);
});
test('read-only CI status matching uses the new CI ID and exact reference',()=>{
  const entries=core.normalizePipelines({pipelines:[
    {ci_id:11,database:'mysql',refname:'mysql-26.10.0',pipeline:'profile',status:'COMPLETE',io_intensive:0,profile_id:1100},
    {ci_id:12,database:'mysql',refname:'mysql-26.10.0',pipeline:'profile',status:'RUNNING',io_intensive:0,profile_id:1101},
    {ci_id:13,database:'vsql',refname:'release/0.0.7',pipeline:'profile',status:'RUNNING',io_intensive:0,profile_id:1200}
  ]});
  const step={database:'mysql',ref:'refs/tags/mysql-26.10.0',after_ci_id:11,io_intensive:0};
  assert.equal(core.matchingPipeline(entries,step).ci_id,12);
  assert.equal(core.matchingPipeline(entries,{...step,after_ci_id:12}),null);
});
test('link to completed profile chooses peak measured NOPM among its jobs',()=>{
  const entries=DBS.map((db,i)=>({jobid:IDS[i],database:db,benchmark:'TPROC-C',profile_id:i+1000}));
  entries.push({jobid:'EE001122334455667788',database:'mysql',benchmark:'TPROC-C',profile_id:1002});
  const reports={};
  reports[IDS[2]]=core.summarizeJob(IDS[2],artifact('mysql',IDS[2],400));
  reports['EE001122334455667788']=core.summarizeJob('EE001122334455667788',artifact('mysql','EE001122334455667788',500));
  const ci={database:'mysql',status:'COMPLETE',ci_id:55,profile_id:1002};
  const selected=core.chooseProfileResult(ci,entries,reports);
  assert.equal(selected.selected.jobid,'EE001122334455667788');
  assert.equal(selected.job_count,2);
  assert.throws(()=>core.chooseProfileResult({...ci,status:'RUNNING'},entries,reports));
});
test('four-way comparison includes only genuine measured numbers',()=>{
  const compared=core.compareMany(summaries());
  assert.deepEqual(compared.order,['vsql','mysql','pg','maria']);
  assert.equal(compared.rows.find(r=>r.field==='nopm').values.mysql,300);
  assert.equal(compared.comparable,false);
  assert.ok(compared.caveats.some(message=>message.includes('cpumodel')));
  assert.equal(compared.reports.length,4);
});
test('comparability warns when hardware and workload settings differ',()=>{
  const runs=summaries();
  runs[1].system.cpucount='96';
  runs[2].config.warehouses='100';
  const result=core.compareMany(runs);
  assert.equal(result.comparable,false);
  assert.ok(result.caveats.some(v=>v.includes('cpucount')));
  assert.ok(result.caveats.some(v=>v.includes('warehouses')));
});
test('job artifact summaries omit hostname and reject mismatched IDs',()=>{
  const sample=artifact('pg',IDS[1],250);
  assert.throws(()=>core.summarizeJob(IDS[2],sample),/ID mismatch/);
  const summary=core.summarizeJob(IDS[1],sample);
  assert.ok(!JSON.stringify(summary).includes('do-not-export-host'));
});
test('multi-engine comparison rejects repeated jobs and fake measurements',()=>{
  const runs=summaries();
  assert.throws(()=>core.compareMany([runs[0],runs[0]]));
  const bad=artifact('pg',IDS[1],100);
  delete bad.result.nopm;delete bad.result.tpm;
  assert.throws(()=>core.summarizeJob(IDS[1],bad),/no measured throughput/);
});
test('browser files parse without executing external requests',()=>{
  for(const name of ['ai-assistant-core.js','ai-assistant.js']){
    const file=path.join(__dirname,'..','src','webservice',name);
    assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(file,'utf8'),{filename:name}));
  }
});

test('AI evidence includes measurements but excludes private host and SQL',()=>{
  const reports=summaries();
  const comparison=core.compareMany(reports);
  const filtered=core.modelEvidence(comparison,[
    {database:'pg',jobid:IDS[1],sample_count:50,
      events:[{name:'IO:DataFileRead',count:22,sql_text:'SELECT secret FROM internal_table'}]}
  ]);
  const encoded=JSON.stringify(filtered);
  assert.ok(encoded.includes('IO:DataFileRead'));
  assert.ok(encoded.includes('sample_count'));
  assert.ok(encoded.includes('nopm'));
  assert.ok(!encoded.includes('do-not-export-host'));
  assert.ok(!encoded.includes('internal_table'));
  assert.ok(!encoded.includes('sql_text'));
});
test('AI endpoint is runtime BYOK, no server default key or insecure TLS',()=>{
  const tcl=fs.readFileSync(path.join(__dirname,'..','src','generic','genaiassistant.tcl'),'utf8');
  assert.match(tcl,/proc wapp-page-ai-chat/);
  assert.match(tcl,/POST/);
  assert.match(tcl,/SAME_ORIGIN/);
  assert.match(tcl,/-require 1 -servername api\.openai\.com/);
  assert.match(tcl,/"store":false/);
  assert.ok(!/sk-[A-Za-z0-9_-]{24,}/.test(tcl));
  assert.ok(!/curl\s+.*-k\b/.test(tcl));
});
test('browser starts the existing pipeline only after sequence confirmation',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','src','webservice','ai-assistant.js'),'utf8');
  assert.match(js,/Approve running these profiles in order/);
  assert.match(js,/sequenceApproved=true/);
  assert.match(js,/\&action=run/);
  assert.match(js,/sameOrigin\(core\.pipelineUrl/);
  assert.match(js,/OpenAI API key cleared/);
  assert.ok(!/localStorage\.setItem\([^)]*api_key/i.test(js));
});
