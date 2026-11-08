/*
 * HammerDB AI Assistant: existing EC2 profile planning, status polling,
 * multi-engine results comparison, and reviewed TPC-OSS sharing.
 * No new pipeline execution endpoint or browser-stored API credentials.
 */
(() => {
  'use strict';
  const core=window.HDBAssistantCore;
  const app=document.getElementById('hdb-ai-app');
  if (!app || !core) return;
  const base=String(app.getAttribute('data-base')||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const log=$('hdb-ai-conversation'), form=$('hdb-ai-form'), prompt=$('hdb-ai-prompt');
  const send=$('hdb-ai-send'), status=$('hdb-ai-status');
  const queueBox=$('hdb-ai-queue'), reportBox=$('hdb-ai-report'), sharing=$('hdb-ai-sharing');
  const KEY='hammerdb-ai-profiles-v1', MAX_STEPS=4;
  let busy=false,lastComparison=null,polling=false,lastPipelines=[],pipelineIndexReady=false;
  let steps=loadSteps();

  function node(tag,text,cls) {
    const el=document.createElement(tag);
    if (text!==undefined) el.textContent=String(text);
    if (cls) el.className=cls;
    return el;
  }
  function anchor(text,href,external=false) {
    const el=node('a',text);
    el.href=href;
    if(external){el.target='_blank';el.rel='noopener noreferrer';}
    return el;
  }
  const sameOrigin=path=>base+'/'+path;
  function talk(text,speaker='assistant') {
    const el=node('p',text,'hdb-ai-message');
    el.dataset.speaker=speaker;
    log.append(el);log.scrollTop=log.scrollHeight;
    return el;
  }
  function fmt(n){return Number(n).toLocaleString(undefined,{maximumFractionDigits:2});}
  function saveSteps() {
    try{localStorage.setItem(KEY,JSON.stringify(steps));}catch(_){}
  }
  function loadSteps() {
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||'[]');
      if(!Array.isArray(saved))return [];
      return saved.slice(0,MAX_STEPS).filter(s=>s&&Object.prototype.hasOwnProperty.call(core.DATABASES,s.database))
        .map(s=>{
          const state=['planned','awaiting-submit','running','complete','failed'].includes(s.state)?s.state:'planned';
          const ref=core.validRef(s.ref)?s.ref:'';
          const after=Number.isSafeInteger(s.after_ci_id)&&s.after_ci_id>=0?s.after_ci_id:0;
          const ci=Number.isSafeInteger(s.ci_id)&&s.ci_id>0?s.ci_id:0;
          let summary=null;
          if(state==='complete' && s.summary && s.summary.database===s.database &&
            core.validJobId(s.summary.jobid) && s.summary.benchmark==='TPROC-C') summary=s.summary;
          return {database:s.database,ref,state:state==='complete'&&!summary?'running':state,
            io_intensive:s.io_intensive===1?1:0,after_ci_id:after,ci_id:ci,
            profile_id:Number(s.profile_id)||0,summary,
            run_count:Number.isInteger(s.run_count)?s.run_count:0};
        });
    }catch(_){return [];}
  }
  async function readJson(url,limit=12*1024*1024){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const res=await fetch(url,{method:'GET',credentials:'same-origin',
        cache:'no-store',redirect:'error',signal:controller.signal,
        headers:{Accept:'application/json'}});
      if(!res.ok)throw Error('HammerDB returned HTTP '+res.status);
      if(!(res.headers.get('content-type')||'').toLowerCase().includes('json'))
        throw Error('Expected a JSON response from HammerDB.');
      const size=Number(res.headers.get('content-length')||0);
      if(size>limit)throw Error('Artifact is too large for preview.');
      let text='';
      if(res.body&&res.body.getReader){
        const reader=res.body.getReader(),decoder=new TextDecoder();
        let bytes=0;
        for(;;){
          const {done,value}=await reader.read();
          if(done)break;
          bytes+=value.byteLength;
          if(bytes>limit){await reader.cancel();throw Error('Artifact size limit exceeded.');}
          text+=decoder.decode(value,{stream:true});
        }
        text+=decoder.decode();
      }else{
        text=await res.text();
        if(text.length>limit)throw Error('Artifact size limit exceeded.');
      }
      try{return JSON.parse(text);}catch(_){throw Error('Invalid JSON from HammerDB.');}
    }finally{clearTimeout(timeout);}
  }
  async function loadJob(id){
    if(!core.validJobId(id))throw Error('Invalid job ID.');
    const artifact=await readJson(sameOrigin(core.artifactUrl(id)));
    if(artifact.error)throw Error('The job has no completed benchmark result.');
    return core.summarizeJob(id,artifact);
  }
  function makeCell(text,heading=false){
    return node(heading?'th':'td',text);
  }
  function tableRow(values,heading=false){
    const row=node('tr');
    for(const val of values)row.append(makeCell(val,heading));
    return row;
  }
  function makeLinks(parent,links){
    const wrap=node('p',undefined,'hdb-ai-links');
    for(const item of links){
      if(wrap.childNodes.length)wrap.append(document.createTextNode(' · '));
      wrap.append(anchor(item.label,item.url,item.external||false));
    }
    parent.append(wrap);
  }
  function shareComparison(compare){
    sharing.replaceChildren();
    sharing.append(node('p','Sharing your measured result helps everyone benchmark database performance. We recommend contributing. You decide what to publish; review every artifact for hostnames, internal identifiers and other sensitive information first.'));
    for(const s of compare.reports){
      const line=node('p');
      line.append(node('span',core.DATABASES[s.database]+' ('+s.jobid+'): '));
      line.append(anchor('Review original JSON',sameOrigin(core.artifactUrl(s.jobid))));
      sharing.append(line);
    }
    makeLinks(sharing,[{label:'Continue to TPC-OSS — propose GitHub PR',url:core.SUBMIT_URL,external:true}]);
    sharing.append(node('p','GitHub sign-in is required for the existing PR submission process. Maintainers review submissions before publication. No automatic upload.','hdb-ai-muted'));
  }
  function renderComparison(compare){
    reportBox.replaceChildren();
    reportBox.append(node('p','Measured TPROC-C profile results: maximum observed NOPM from each selected profile job, or the selected completed artifact.'));
    const wrap=node('div',undefined,'hdb-ai-table-wrap');
    const table=node('table',undefined,'hdb-ai-comparison');
    table.append(tableRow(['Measurement',...compare.reports.map(r=>core.DATABASES[r.database])],true));
    for(const m of compare.rows){
      table.append(tableRow([m.label,...compare.reports.map(r=>m.values[r.database]==null?'—':fmt(m.values[r.database]))]));
    }
    table.append(tableRow(['Source job',...compare.reports.map(s=>s.jobid)]));
    table.append(tableRow(['Database version',...compare.reports.map(s=>s.release||'—')]));
    table.append(tableRow(['Virtual users',...compare.reports.map(s=>s.config.virtual_users||'—')]));
    wrap.append(table);reportBox.append(wrap);
    if(compare.order.length&&compare.comparable){
      reportBox.append(node('p','For these specific jobs, NOPM order (highest first): '+
        compare.order.map(db=>core.DATABASES[db]).join(', ')+'. This does not establish general database superiority.'));
    }else{
      reportBox.append(node('p','These measurements can be compared, but the test environments/configurations may differ. Do not interpret the figures as a fair engine ranking.'));
    }
    if(compare.caveats.length){
      const box=node('div',undefined,'hdb-ai-warning');
      box.append(node('strong','Comparison cautions'));
      const list=node('ul');
      for(const warning of compare.caveats)list.append(node('li',warning));
      box.append(list);reportBox.append(box);
    }
    if(compare.latency.length){
      reportBox.append(node('h3','Response-time percentiles (milliseconds)'));
      const outer=node('div',undefined,'hdb-ai-table-wrap'),t=node('table',undefined,'hdb-ai-comparison');
      t.append(tableRow(['Transaction',...compare.reports.map(s=>core.DATABASES[s.database]+' p95 / p99')],true));
      for(const metric of compare.latency){
        t.append(tableRow([metric.name,...compare.reports.map(s=>{
          const times=metric.values[s.database];
          return times?(times.p95_ms==null?'—':fmt(times.p95_ms))+' / '+(times.p99_ms==null?'—':fmt(times.p99_ms)):'—';
        })]));
      }
      outer.append(t);reportBox.append(outer);
    }
    reportBox.append(node('p',compare.note,'hdb-ai-muted'));
    shareComparison(compare);
    lastComparison=compare;
  }
  function prepareQueue(request){
    if(request.workload!=='TPROC-C')throw Error('Phase 1 profiles use TPROC-C; select a TPROC-C workload.');
    const dbs=request.databases;
    if(!dbs.length)throw Error('Name a database to profile.');
    let added=0;
    for(const db of dbs){
      const ref=request.refs[db]||'';
      let s=steps.find(item=>item.database===db);
      if(!s){
        if(steps.length>=MAX_STEPS)throw Error('The sequence already has four databases. Clear it to start a new one.');
        s={database:db,ref,io_intensive:request.io_intensive,state:'planned',
          after_ci_id:0,ci_id:0,profile_id:0,summary:null,run_count:0};
        steps.push(s);added++;
      }else if(s.state==='planned'&&ref){
        s.ref=ref;s.io_intensive=request.io_intensive;
      }
    }
    saveSteps();renderQueue();
    talk((added?'Prepared ':'Updated ')+steps.length+' EC2 TPROC-C profile step(s) in order: '+
      steps.map(s=>core.DATABASES[s.database]).join(' → ')+
      '. Enter a Git ref for each database, then open the first planned step in Pipelines to confirm its start.');
    talk('Existing EC2 settings control socket/core count; it is not part of this webhook request. I/O intensive is '+(request.io_intensive?'ON':'OFF')+'.');
  }
  function renderQueue(){
    queueBox.replaceChildren();
    if(!steps.length){queueBox.append(node('p','Ask to profile MariaDB, PostgreSQL, MySQL and VillageSQL, or add databases in separate messages.','hdb-ai-muted'));return;}
    steps.forEach((s,index)=>{
      const card=node('article',undefined,'hdb-ai-run');
      card.append(node('h3',(index+1)+'. '+core.DATABASES[s.database]));
      const stageLabel=s.state==='planned'?'Waiting for confirmation':
        s.state==='awaiting-submit'?'Waiting for pipeline submission':
        s.state==='running'?'Pipeline running / checking results':
        s.state==='complete'?'Completed':'Pipeline failed';
      card.append(node('p',stageLabel+(s.ci_id?' · Pipeline '+s.ci_id:'')+
        (s.profile_id?' · Profile '+s.profile_id:''),'hdb-ai-muted'));
      if(s.state==='planned'){
        const label=node('label','Git ref for '+core.DATABASES[s.database]);
        const input=node('input');
        input.type='text';input.maxLength=190;input.value=s.ref;
        input.placeholder='refs/tags/... or refs/heads/...';
        input.autocomplete='off';
        input.addEventListener('input',()=>{s.ref=input.value.trim();saveSteps();});
        label.append(input);card.append(label);
        card.append(node('p','TPROC-C PROFILE · I/O-intensive '+(s.io_intensive?'ON':'OFF'),'hdb-ai-muted'));
        if(index===0||steps[index-1].state==='complete'){
          const link=anchor('Open reviewed profile in Pipelines',core.validRef(s.ref)?sameOrigin(core.pipelineUrl(s.database,s.ref,s.io_intensive)):'#',true);
          link.addEventListener('click',event=>{
            if(!pipelineIndexReady){
              event.preventDefault();talk('Check pipeline status first so this sequence cannot mistake a previous run for a new one.');return;
            }
            if(!core.validRef(s.ref)){
              event.preventDefault();talk('Please enter a valid Git ref for '+core.DATABASES[s.database]+'.');input.focus();return;
            }
            // Existing Pipelines page requires a separate explicit Run Benchmark click.
            link.href=sameOrigin(core.pipelineUrl(s.database,s.ref,s.io_intensive));
            const highest=lastPipelines.reduce((max,p)=>Math.max(max,p.ci_id),0);
            s.after_ci_id=highest;s.state='awaiting-submit';
            saveSteps();
            setTimeout(renderQueue,0);
            talk('Review '+core.DATABASES[s.database]+' '+s.ref+' in Pipelines and confirm Run Benchmark there. I will check the existing pipeline status.');
          });
          card.append(link);
        }else card.append(node('p','Ready after the preceding profile completes.','hdb-ai-muted'));
      }else if(s.state==='failed'){
        const button=node('button','Retry step');
        button.type='button';
        button.addEventListener('click',()=>{s.state='planned';s.ci_id=0;s.profile_id=0;s.summary=null;saveSteps();renderQueue();});
        card.append(button);
      }else if(s.state==='complete'&&s.summary){
        const nopm=s.summary.metrics.find(m=>m.field==='nopm');
        card.append(node('p','Peak measured NOPM: '+(nopm?fmt(nopm.value):'not recorded')+
          ' · job '+s.summary.jobid,'hdb-ai-muted'));
        makeLinks(card,[{label:'Inspect job',url:sameOrigin('jobs?jobid='+encodeURIComponent(s.summary.jobid)+'&summary')},
          {label:'Review original JSON',url:sameOrigin(core.artifactUrl(s.summary.jobid))}]);
      }else if(s.ci_id) {
        makeLinks(card,[{label:'See pipeline details',url:sameOrigin('ci?ci_id='+s.ci_id)}]);
      }
      queueBox.append(card);
    });
  }
  async function loadProfile(ci) {
    const jobIndex=core.normalizeJobList(await readJson(sameOrigin('ai-jobs'),256*1024));
    const jobs=jobIndex.filter(j=>j.profile_id===ci.profile_id&&
      j.database===ci.database&&j.benchmark==='TPROC-C').slice(0,40);
    if(!jobs.length)throw Error('No linked profile job artifacts yet.');
    const summaries={};
    for(const item of jobs){
      try{summaries[item.jobid]=await loadJob(item.jobid);}catch(_){}
    }
    return core.chooseProfileResult(ci,jobIndex,summaries);
  }
  async function updateSequence() {
    if(polling)return;
    polling=true;
    try{
      const pipelines=core.normalizePipelines(await readJson(sameOrigin('ai-pipelines'),256*1024));
      lastPipelines=pipelines;pipelineIndexReady=true;
      let changed=false;
      for(let i=0;i<steps.length;i++){
        const s=steps[i];
        if(s.state!=='awaiting-submit' && s.state!=='running')continue;
        let ci=s.ci_id?pipelines.find(p=>p.ci_id===s.ci_id):null;
        if(!ci)ci=core.matchingPipeline(pipelines,s);
        if(!ci)continue;
        if(!s.ci_id){s.ci_id=ci.ci_id;s.state='running';changed=true;talk(core.DATABASES[s.database]+' pipeline '+ci.ci_id+' was submitted. Checking for completion.');}
        if(['FAILED','ERROR','CANCELLED','CANCELED','ABORTED'].includes(ci.status)){
          s.state='failed';changed=true;
          talk(core.DATABASES[s.database]+' pipeline '+ci.ci_id+' ended with '+ci.status+'. The sequence will not start another run.');
          break;
        }
        if(ci.status==='COMPLETE'){
          try{
            const profile=await loadProfile(ci);
            s.state='complete';s.profile_id=profile.profile_id;s.summary=profile.selected;
            s.run_count=profile.job_count;changed=true;
            talk(core.DATABASES[s.database]+' completed: profile '+ci.profile_id+
              ', '+profile.job_count+' measured job(s); peak NOPM job '+profile.selected.jobid+'.');
            if(steps[i+1]&&steps[i+1].state==='planned')
              talk('Next: '+core.DATABASES[steps[i+1].database]+' is ready for review in Pipelines.');
          }catch(_){
            // COMPLETE may appear before summaryjson artifacts are available.
            s.profile_id=ci.profile_id;changed=true;
          }
        }
        break; // Only the first unfinished step advances.
      }
      if(changed){saveSteps();renderQueue();}
      if(steps.length>=2&&steps.every(s=>s.state==='complete')){
        const reports=steps.map(s=>s.summary);
        if(!lastComparison||lastComparison.reports.length!==reports.length||lastComparison.reports.some((r,i)=>r.jobid!==reports[i].jobid)){
          const comp=core.compareMany(reports);
          renderComparison(comp);talk('All four-engine sequence steps that were requested are complete. I compared the actual job artifacts and recommend reviewing them for TPC-OSS sharing.');
        }
      }
    }catch(err){status.textContent='Status unavailable: '+err.message;}
    finally{polling=false;}
  }
  async function compareExisting(request){
    if(request.workload!=='TPROC-C')throw Error('Phase 1 comparison supports TPROC-C profiles.');
    const desired=request.databases.length?request.databases:Object.keys(core.DATABASES);
    const selected=[];
    if(request.ids && request.ids.length>=2){
      for(const id of request.ids)selected.push(await loadJob(id));
    } else {
      const jobs=core.normalizeJobList(await readJson(sameOrigin('ai-jobs'),256*1024));
      for(const db of desired){
        const candidates=jobs.filter(item=>item.database===db&&item.benchmark==='TPROC-C'&&item.profile_id>0);
        if(!candidates.length)throw Error('No '+core.DATABASES[db]+' TPROC-C profile jobs were found.');
        const recentProfile=candidates[0].profile_id;
        let best=null,highest=-1;
        for(const j of candidates.filter(item=>item.profile_id===recentProfile).slice(0,40)){
          try{
            const summary=await loadJob(j.jobid);
            const nopm=summary.metrics.find(m=>m.field==='nopm')?.value;
            if(nopm!=null&&nopm>highest){highest=nopm;best=summary;}
          }catch(_){}
        }
        if(!best)throw Error('No completed '+core.DATABASES[db]+' TPROC-C artifacts for its latest profile.');
        selected.push(best);
      }
    }
    const comp=core.compareMany(selected);
    renderComparison(comp);
    talk('Compared '+comp.reports.map(s=>core.DATABASES[s.database]+' job '+s.jobid).join(', ')+
      '. See the measured results and comparability warnings. Sharing them would help the community; publication requires your GitHub PR.');
  }
  async function handle(message){
    const req=core.parseIntent(message);
    if(req.kind==='profile'){prepareQueue(req);return;}
    if(req.kind==='compare'){
      if(steps.length>=2&&steps.every(s=>s.state==='complete')){
        const comp=core.compareMany(steps.map(s=>s.summary));
        renderComparison(comp);
        talk('Compared the completed sequence. Please consider sharing each reviewed result with TPC-OSS.');
      }else{
        talk('Looking for completed TPROC-C profile artifacts in HammerDB Jobs…');
        await compareExisting(req);
      }
      return;
    }
    if(req.kind==='share'){
      talk('Sharing real benchmark results helps others make informed decisions. Review the original JSON for sensitive machine details, then use the TPC-OSS GitHub PR link below. Nothing is uploaded automatically.');
      if(lastComparison)shareComparison(lastComparison);
      return;
    }
    talk('Try “Run profiles on MariaDB, PostgreSQL, MySQL and VillageSQL, then compare” or “Now VillageSQL 0.0.7” or “Compare the four databases”. You can also paste a cipush command to prepare that exact run.');
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    const message=prompt.value.trim();
    if(!message)return;
    talk(message,'user');
    prompt.value='';busy=true;send.disabled=true;status.textContent='Processing…';
    try{await handle(message);await updateSequence();}
    catch(err){talk('I could not complete that: '+err.message);}
    finally{busy=false;send.disabled=false;status.textContent='';prompt.focus();}
  });
  $('hdb-ai-refresh').addEventListener('click',async()=>{await updateSequence();if(!polling)talk('Checked existing pipeline statuses.');});
  $('hdb-ai-clear').addEventListener('click',()=>{
    if(!window.confirm('Clear the locally planned sequence? This does not cancel existing benchmark jobs.'))return;
    steps=[];lastComparison=null;saveSteps();renderQueue();talk('Sequence cleared. Existing HammerDB pipelines and jobs were not changed.');
  });
  renderQueue();
  updateSequence();
  setInterval(()=>{if(steps.some(s=>s.state==='awaiting-submit'||s.state==='running'))updateSequence();},15000);
  talk('Ask me to run and compare MariaDB, PostgreSQL, MySQL and VillageSQL profiles. I will check the existing jobs and help you submit reviewed results to TPC-OSS.');
})();