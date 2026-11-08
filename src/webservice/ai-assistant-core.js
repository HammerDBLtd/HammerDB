/*
 * HammerDB AI Assistant: deterministic planning and comparison over existing
 * EC2 profile pipelines and real HammerDB result artifacts.
 * No AI keys, benchmark execution, uploads, or external requests in this file.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HDBAssistantCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DATABASES = Object.freeze({maria:'MariaDB',pg:'PostgreSQL',mysql:'MySQL',vsql:'VillageSQL'});
  const SUBMIT_URL = 'https://tpc-council.github.io/hammerdb-results/submit.html';
  const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
  const REF = /^refs\/(?:tags|heads)\/[A-Za-z0-9._/-]{1,180}$/;
  const CONFIG_KEYS = ['warehouses','virtual_users','scale_factor','rampup_minutes','duration_minutes'];
  const SYSTEM_KEYS = ['cloud_instance','system_type','cpumodel','cpucount','memory','storage'];
  const DATABASE_PATTERN = /\b(village[\s-]*sql|villagesql|village|vsql|postgresql|postgres|pg|mariadb|maria|mysql)\b/gi;

  function database(value) {
    const name = String(value || '').toLowerCase().replace(/[\s_-]/g,'');
    if (['pg','postgres','postgresql'].includes(name)) return 'pg';
    if (['maria','mariadb'].includes(name)) return 'maria';
    if (name === 'mysql') return 'mysql';
    if (['village','villagesql','vsql'].includes(name)) return 'vsql';
    return null;
  }
  function validJobId(value) {return typeof value==='string' && JOB_ID.test(value);}
  function validRef(value) {
    return typeof value==='string' && REF.test(value) && !value.includes('..') &&
      !value.includes('//') && !value.endsWith('/') &&
      !value.split('/').some(s=>s.startsWith('-') || s === '.');
  }
  function normalizedRef(value) {
    if (!validRef(value)) throw Error('Supply a valid refs/tags/... or refs/heads/... Git ref.');
    return value;
  }
  function refName(ref) { return normalizedRef(ref).replace(/^refs\/(?:heads|tags)\//,''); }
  function inferRef(db, context) {
    const t = String(context || '');
    const match = t.match(/\brefs\/(?:tags|heads)\/[A-Za-z0-9._/-]+/i);
    if (match && validRef(match[0])) return match[0];
    const m = db === 'mysql' ? t.match(/\b(?:mysql)\s+(?:version\s+)?(\d+(?:\.\d+){1,3})\b/i)
      : db === 'vsql' ? t.match(/\b(?:village[\s-]*sql|village|vsql)\s+(?:version\s+)?(\d+(?:\.\d+){1,3})\b/i) : null;
    if (!m) return null;
    const candidate='refs/tags/'+(db==='mysql'?'mysql-':'release/')+m[1];
    return validRef(candidate)?candidate:null;
  }
  function parseIntent(raw) {
    const text=String(raw||'').trim();
    if (!text || text.length>4000) throw Error('Enter a message of up to 4,000 characters.');
    const positions=[];
    for (const match of text.matchAll(DATABASE_PATTERN)) {
      const db=database(match[0]);
      if (db && !positions.some(p=>p.db===db)) positions.push({db,index:match.index});
    }
    const databases=positions.map(p=>p.db);
    const refs={};
    for (let i=0;i<positions.length;i++) {
      const from=positions[i].index;
      const to=i+1<positions.length?positions[i+1].index:text.length;
      const part=text.slice(from,to);
      const ref=inferRef(positions[i].db,part);
      if (ref) refs[positions[i].db]=ref;
    }
    // Explicit cipush commands are authoritative examples of already validated
    // input syntax, not authority to execute anything.
    for (const match of text.matchAll(/\bcipush\s+(refs\/(?:tags|heads)\/[A-Za-z0-9._/-]+)\s+profile\s+C\s+(mysql|vsql|pg|maria)\s+(0|1)\b/gi)) {
      const db=database(match[2]);
      if (db && validRef(match[1])) refs[db]=match[1];
    }
    const ids=[...text.matchAll(/\b([A-Fa-f0-9]{16,40})\b/g)]
      .map(m=>m[1]).filter(validJobId).slice(0,4);
    const workload=/\btproc[\s-]*h\b/i.test(text)?'TPROC-H':'TPROC-C';
    const io_intensive=/\b(?:i\/o[\s-]*intensive|io[\s-]*intensive)\s*(?:on|true|1)\b/i.test(text)?1:0;
    const wantsRun=/\b(run|start|profile|benchmark|execute|test|now|next)\b/i.test(text);
    const wantsCompare=/\b(compare|comparison|versus|vs\.?|against|difference|differ|better)\b/i.test(text);
    const wantsShare=/\b(share|submit|publish|github|leaderboard|contribute)\b/i.test(text);
    if (wantsRun && (databases.length || Object.keys(refs).length))
      return {kind:'profile',databases,refs,workload,io_intensive,compareAfter:wantsCompare,shareAfter:wantsShare};
    if (wantsCompare || ids.length>1)
      return {kind:'compare',databases:databases.length?databases:Object.keys(DATABASES),ids,workload};
    if (wantsShare) return {kind:'share',databases,workload};
    return {kind:'help',databases,workload};
  }
  function planProfile(db,ref,io=0) {
    if (!Object.prototype.hasOwnProperty.call(DATABASES,db)) throw Error('Unsupported database.');
    if (io!==0 && io!==1) throw Error('I/O intensive must be 0 or 1.');
    return Object.freeze({ref:normalizedRef(ref),pipeline:'profile',workload:'C',
      database:db,io_intensive:io});
  }
  function pipelineUrl(db,ref,io=0) {
    const payload=planProfile(db,ref,io);
    const pairs={
      db:payload.database,pipeline:'profile',workload:'C',
      tag_sel:'__custom__',ref_custom:payload.ref,io_intensive:String(io)
    };
    return 'pipelines?'+Object.entries(pairs)
      .map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
    // Intentionally NO action=run. Existing Pipelines form must confirm execution.
  }
  function artifactUrl(id) {
    if (!validJobId(id)) throw Error('Invalid job ID.');
    return 'jobs?jobid='+encodeURIComponent(id)+'&summaryjson';
  }
  function finite(value) {
    if (typeof value!=='number' && typeof value!=='string') return null;
    if (typeof value==='string' && !value.trim()) return null;
    const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
  }
  function normalizeJobList(response) {
    if (!response || !Array.isArray(response.jobs)) throw Error('Invalid job list response.');
    return response.jobs.slice(0,200).map(item=>{
      const db=database(item.database);
      const benchmark=String(item.benchmark||'').replace(/^TPC-/,'TPROC-');
      const profile_id=Number(item.profile_id);
      if (!validJobId(item.jobid)||!db||!['TPROC-C','TPROC-H'].includes(benchmark))return null;
      return {jobid:item.jobid,database:db,benchmark,
        profile_id:Number.isSafeInteger(profile_id)&&profile_id>0?profile_id:0,
        timestamp:String(item.timestamp||'').slice(0,40)};
    }).filter(Boolean);
  }
  function normalizePipelines(response) {
    if (!response||!Array.isArray(response.pipelines))throw Error('Invalid pipeline status response.');
    return response.pipelines.slice(0,100).map(p=>{
      const id=Number(p.ci_id),db=database(p.database),
        profile=Number(p.profile_id),status=String(p.status||'').toUpperCase();
      if (!Number.isSafeInteger(id)||id<=0||!db||!/^[A-Z_ ]{2,40}$/.test(status))return null;
      return {ci_id:id,database:db,refname:String(p.refname||'').slice(0,180),
        pipeline:String(p.pipeline||'').toLowerCase(),status,
        profile_id:Number.isSafeInteger(profile)&&profile>0?profile:0,
        io_intensive:Number(p.io_intensive)===1?1:0,
        timestamp:String(p.timestamp||'').slice(0,40)};
    }).filter(Boolean);
  }
  function matchingPipeline(pipelines,step) {
    if (!step || !step.ref || !step.database) return null;
    const baseline=Number(step.after_ci_id)||0,ref=refName(step.ref);
    return pipelines.filter(p=>p.ci_id>baseline && p.database===step.database &&
      p.pipeline==='profile' && p.refname===ref && p.io_intensive===step.io_intensive)
      .sort((a,b)=>b.ci_id-a.ci_id)[0]||null;
  }
  function summarizeJob(id,artifact) {
    if (!validJobId(id))throw Error('Invalid job ID.');
    if (!artifact||artifact.schema!=='hammerdb-job-report-v1'||!artifact.job||!artifact.result)
      throw Error('Not a supported HammerDB result artifact.');
    const job=artifact.job,result=artifact.result;
    if (job.jobid!==id)throw Error('Job ID mismatch in artifact.');
    const db=database(job.database);
    if (!db)throw Error('Unsupported database.');
    if (job.benchmark!=='TPROC-C'||result.type!=='tproc_c_result')
      throw Error('Phase 1 profile comparison requires a completed TPROC-C result.');
    const metrics=[];
    for (const [field,label] of [['nopm','NOPM'],['tpm','TPM']]) {
      const value=finite(result[field]);
      if(value!==null)metrics.push({field,label,value,unit:'per minute'});
    }
    if (!metrics.length)throw Error('Result has no measured throughput.');
    const config={},system={},latency={};
    for(const key of CONFIG_KEYS)if(artifact.benchmark_config&&
      Object.prototype.hasOwnProperty.call(artifact.benchmark_config,key))
      config[key]=String(artifact.benchmark_config[key]).slice(0,160);
    for(const key of SYSTEM_KEYS) {
      const val=artifact.system&&artifact.system[key];
      if(typeof val==='string'||typeof val==='number')system[key]=String(val).slice(0,220);
    }
    if(artifact.response_times&&Array.isArray(artifact.response_times.rows)){
      for(const row of artifact.response_times.rows.slice(0,40)){
        const name=String(row.name||'').toUpperCase();
        if(!/^[A-Z0-9_]{1,30}$/.test(name))continue;
        const p95=finite(row.p95_ms),p99=finite(row.p99_ms);
        if(p95!==null||p99!==null)latency[name]={p95_ms:p95,p99_ms:p99};
      }
    }
    return {jobid:id,database:db,benchmark:job.benchmark,
      release:String(job.release||'').slice(0,100),
      hdb_version:String(job.hdb_version||'').slice(0,80),
      timestamp:String(job.timestamp||'').slice(0,60),
      config,system,metrics,latency};
  }
  function chooseProfileResult(ci,jobs,reportById) {
    if(!ci || ci.status!=='COMPLETE' || !Number.isSafeInteger(ci.profile_id)||ci.profile_id<1)
      throw Error('The pipeline has not completed a linked performance profile.');
    const candidates=jobs.filter(j=>j.profile_id===ci.profile_id&&
      j.database===ci.database&&j.benchmark==='TPROC-C');
    const reports=candidates.map(j=>reportById[j.jobid]).filter(Boolean);
    if(!reports.length)throw Error('No completed TPROC-C job artifacts for this profile.');
    // The existing HammerDB profile page uses the maximum measured NOPM.
    const sorted=reports.slice().sort((a,b)=>{
      const av=a.metrics.find(x=>x.field==='nopm')?.value??-1;
      const bv=b.metrics.find(x=>x.field==='nopm')?.value??-1;
      return bv-av;
    });
    const selected=sorted[0];
    if(!selected.metrics.some(x=>x.field==='nopm'))throw Error('Profile has no measured NOPM.');
    return {selected,job_count:reports.length,profile_id:ci.profile_id,ci_id:ci.ci_id};
  }
  function compareMany(reports) {
    if(!Array.isArray(reports)||reports.length<2||reports.length>4)
      throw Error('Compare two to four completed reports.');
    const seen=new Set();
    for(const s of reports){
      if(!s||!Object.prototype.hasOwnProperty.call(DATABASES,s.database)||
        s.benchmark!=='TPROC-C'||seen.has(s.database)||!validJobId(s.jobid))
        throw Error('Select distinct, valid TPROC-C database reports.');
      seen.add(s.database);
    }
    const fields=['nopm','tpm'],rows=[];
    for(const field of fields){
      const values={};
      for(const summary of reports) {
        const metric=summary.metrics.find(m=>m.field===field);
        if(metric)values[summary.database]=metric.value;
      }
      if(Object.keys(values).length===reports.length)
        rows.push({field,label:field.toUpperCase(),values,unit:'per minute'});
    }
    if(!rows.length)throw Error('No shared measured throughput to compare.');
    const caveats=[];
    for(const key of CONFIG_KEYS) {
      const values=reports.map(s=>s.config[key]||'');
      if(new Set(values).size>1)caveats.push(key+': values differ or are missing');
      else if(!values[0] && ['warehouses','virtual_users','duration_minutes'].includes(key))
        caveats.push(key+': not recorded in these artifacts');
    }
    for(const key of SYSTEM_KEYS) {
      const values=reports.map(s=>s.system[key]||'');
      if(new Set(values).size>1)caveats.push('System '+key+': values differ or are missing');
      else if(!values[0] && ['cloud_instance','cpumodel','cpucount'].includes(key))
        caveats.push('System '+key+': not recorded for any run');
    }
    if(new Set(reports.map(s=>s.hdb_version)).size>1)caveats.push('HammerDB version differs');
    const names=[...new Set(reports.flatMap(s=>Object.keys(s.latency)))].slice(0,10);
    const latency=names.map(name=>{
      const values={};
      for(const s of reports)if(s.latency[name])values[s.database]=s.latency[name];
      return {name,values};
    }).filter(r=>Object.keys(r.values).length>1);
    const nopm=rows.find(r=>r.field==='nopm');
    const order=nopm?reports.slice().sort((a,b)=>nopm.values[b.database]-nopm.values[a.database])
      .map(s=>s.database):[];
    return {reports,rows,caveats,latency,order,comparable:caveats.length===0,
      note:'These are real, unaudited HammerDB measurements, not an audited TPC result. A higher NOPM in these runs does not establish that an engine is universally faster. Review test and system configuration.'};
  }
  return Object.freeze({DATABASES,SUBMIT_URL,database,validJobId,validRef,refName,inferRef,parseIntent,
    planProfile,pipelineUrl,artifactUrl,normalizeJobList,normalizePipelines,matchingPipeline,
    summarizeJob,chooseProfileResult,compareMany});
});