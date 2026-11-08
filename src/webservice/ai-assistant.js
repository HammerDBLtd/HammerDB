/*
 * HammerDB AI Assistant: on-page chat over existing, measured job artifacts.
 * Uses same-origin read-only endpoints. No external AI provider or credential.
 */
(() => {
  'use strict';
  const core = window.HDBAssistantCore;
  const app = document.getElementById('hdb-ai-app');
  if (!app || !core) return;
  const base = String(app.getAttribute('data-base') || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  const log = $('hdb-ai-conversation');
  const form = $('hdb-ai-form');
  const prompt = $('hdb-ai-prompt');
  const send = $('hdb-ai-send');
  const status = $('hdb-ai-status');
  const report = $('hdb-ai-report');
  const sharing = $('hdb-ai-sharing');
  let lastComparison = null;
  let busy = false;

  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function anchor(text, href, external = false) {
    const node = element('a',text);
    node.href = href;
    if (external) { node.target='_blank'; node.rel='noopener noreferrer'; }
    return node;
  }
  function sameOrigin(path) { return base + '/' + path; }
  function talk(text, speaker = 'assistant') {
    const node = element('p',text,'hdb-ai-message');
    node.dataset.speaker=speaker;
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }
  function setBusy(value, description) {
    busy=value;
    send.disabled=value;
    status.textContent=description||'';
  }
  function number(value) {
    return Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
  }
  function formatPct(value) {
    return value == null ? 'n/a' : (value >= 0 ? '+' : '') + number(value) + '%';
  }
  function row(cells, heading = false) {
    const tr = document.createElement('tr');
    for (const cell of cells) tr.append(element(heading?'th':'td',cell));
    return tr;
  }
  function links(container, items) {
    const wrap = element('div',undefined,'hdb-ai-links');
    for (const item of items) wrap.append(anchor(item.label,item.url,!!item.external));
    container.append(wrap);
  }

  async function readJson(url, limit = 12 * 1024 * 1024) {
    const controller = new AbortController();
    const timeout = window.setTimeout(()=>controller.abort(),20000);
    try {
      const response = await fetch(url,{
        method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
        signal:controller.signal,headers:{Accept:'application/json'}
      });
      if (!response.ok) throw Error('HammerDB returned HTTP '+response.status);
      if (!(response.headers.get('content-type')||'').toLowerCase().includes('json'))
        throw Error('HammerDB did not return JSON.');
      const length=Number(response.headers.get('content-length')||0);
      if (length>limit) throw Error('Result is too large for the assistant.');
      let text='';
      if (response.body && typeof response.body.getReader === 'function') {
        const reader=response.body.getReader(),decoder=new TextDecoder();
        let size=0;
        for (;;) {
          const {done,value}=await reader.read();
          if (done) break;
          size+=value.byteLength;
          if (size>limit) { await reader.cancel(); throw Error('Result exceeds assistant size limit.'); }
          text+=decoder.decode(value,{stream:true});
        }
        text+=decoder.decode();
      } else {
        text=await response.text();
        if (text.length>limit) throw Error('Result exceeds assistant size limit.');
      }
      try { return JSON.parse(text); }
      catch (_) { throw Error('Invalid JSON returned by HammerDB.'); }
    } finally { window.clearTimeout(timeout); }
  }

  async function loadJob(id) {
    if (!core.validJobId(id)) throw Error('Invalid job ID.');
    const data=await readJson(sameOrigin(core.artifactUrl(id)));
    if (data && data.error) throw Error('Job is not complete or has no result.');
    return core.summarizeJob(id,data);
  }
  async function findLatest(db, benchmark, index) {
    const candidates=index.filter(j=>j.database===db && j.benchmark===benchmark).slice(0,12);
    for (const candidate of candidates) {
      try { return await loadJob(candidate.jobid); }
      catch (_) { /* An incomplete job is not a benchmark result. */ }
    }
    throw Error('No completed '+core.DATABASES[db]+' '+benchmark+' result found. Run a profile using Pipelines and try again.');
  }
  async function resolvePair(request) {
    if (request.ids && request.ids.length===2) {
      const a=await loadJob(request.ids[0]);
      const b=await loadJob(request.ids[1]);
      return a.database==='pg' ? [a,b] : [b,a];
    }
    const index=core.normalizeJobList(await readJson(sameOrigin('ai-jobs'),128*1024));
    if (!index.length) throw Error('No PostgreSQL or MariaDB jobs found. Start profiles from Pipelines first.');
    const pg=await findLatest('pg',request.benchmark,index);
    const maria=await findLatest('maria',request.benchmark,index);
    return [pg,maria];
  }
  function sharePanel(comparison) {
    sharing.replaceChildren();
    sharing.append(element('p','Consider contributing either measured result to TPC-OSS. Publication is not automatic. Review the original JSON for host and environment details first.'));
    const items=[
      {label:'PostgreSQL original JSON',url:sameOrigin(core.artifactUrl(comparison.pg.jobid))},
      {label:'MariaDB original JSON',url:sameOrigin(core.artifactUrl(comparison.maria.jobid))},
      {label:'Continue to TPC-OSS (GitHub PR)',url:core.SUBMIT_URL,external:true}
    ];
    links(sharing,items);
    sharing.append(element('p','The submission site supports artifact upload and GitHub sign-in. A GitHub account is required to propose a PR; maintainers review it before publication.','hdb-ai-muted'));
  }
  function renderComparison(comparison) {
    report.replaceChildren();
    const title=element('p','PostgreSQL job '+comparison.pg.jobid+' vs MariaDB job '+comparison.maria.jobid);
    report.append(title);
    const box=element('div',undefined,'hdb-ai-table-wrap');
    const table=element('table',undefined,'hdb-ai-comparison');
    table.append(row(['Metric','PostgreSQL','MariaDB','MariaDB vs PostgreSQL'],true));
    for (const result of comparison.rows) {
      table.append(row([result.label,number(result.pg)+' '+result.unit,
        number(result.maria)+' '+result.unit,formatPct(result.percentage)]));
    }
    box.append(table);report.append(box);
    const nopm=comparison.rows.find(item=>item.field==='nopm');
    if (nopm && nopm.percentage!==null) {
      const direction=nopm.percentage>0?'higher':nopm.percentage<0?'lower':'the same';
      const detail=nopm.percentage===0?'the same NOPM':Math.abs(nopm.percentage).toFixed(1)+'% '+direction+' NOPM';
      report.append(element('p','MariaDB recorded '+detail+
        ' than PostgreSQL in these particular runs (relative to PostgreSQL NOPM).'+
        ' NOPM is the primary TPROC-C comparison metric.'));
    } else if (comparison.rows.length) {
      report.append(element('p','The table shows measured values. For TPROC-H duration metrics, lower is generally better.'));
    }
    if (comparison.latency.length) {
      const latencyTable=element('table',undefined,'hdb-ai-comparison');
      latencyTable.append(row(['Transaction','PostgreSQL p95 (ms)','MariaDB p95 (ms)','PostgreSQL p99 (ms)','MariaDB p99 (ms)'],true));
      for (const r of comparison.latency) {
        const value=x=>x===null?'n/a':number(x);
        latencyTable.append(row([r.name,value(r.pgP95),value(r.mariaP95),value(r.pgP99),value(r.mariaP99)]));
      }
      const wrapper=element('div',undefined,'hdb-ai-table-wrap');
      wrapper.append(latencyTable);report.append(element('h3','Response-time percentiles'));report.append(wrapper);
    }
    if (comparison.caveats.length) {
      const warning=element('section',undefined,'hdb-ai-warning');
      warning.append(element('strong','Comparability caveats'));
      const list=element('ul');
      for (const text of comparison.caveats) list.append(element('li',text));
      warning.append(list);report.append(warning);
    }
    report.append(element('p',comparison.note,'hdb-ai-muted'));
    sharePanel(comparison);
  }
  function profileHelp(request) {
    const databases=request.databases;
    const message=talk('Use the existing HammerDB Pipelines page to prepare a '+request.benchmark+
      ' profile. Choose the Git ref and review the parameters there; the assistant will not start the run for you.');
    const items=databases.map(db=>({
      label:core.DATABASES[db]+' profile in Pipelines',
      url:sameOrigin(core.pipelineUrl(db,request.benchmark)),external:false
    }));
    links(message,items);
    talk('After the profiles complete, ask: “Compare PostgreSQL and MariaDB”. I will read the latest completed local result artifacts.');
  }
  async function handle(raw) {
    const request=core.parseIntent(raw);
    if (request.kind==='profile') { profileHelp(request);return; }
    if (request.kind==='compare') {
      talk('Looking for completed '+request.benchmark+' results in existing HammerDB Jobs…');
      const pair=await resolvePair(request);
      const comparison=core.compareJobs(pair[0],pair[1]);
      lastComparison=comparison;
      renderComparison(comparison);
      talk('I compared measured artifacts '+comparison.pg.jobid+' and '+comparison.maria.jobid+
        '. See the table and configuration caveats below. Sharing is offered, never automatic.');
      return;
    }
    if (request.kind==='share') {
      if (lastComparison) {
        sharePanel(lastComparison);
        talk('Use the original JSON links below, review the artifact, then submit through TPC-OSS with your own GitHub account.');
      } else {
        talk('First compare two completed runs, or use the existing Jobs report to download a result artifact. The TPC-OSS link is below.');
      }
      return;
    }
    talk('Try “Please compare PostgreSQL to MariaDB”, “Run a PostgreSQL profile”, “Compare TPROC-H Postgres vs MariaDB”, or “Submit to GitHub”.');
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy) return;
    const text=prompt.value.trim();
    if (!text) return;
    talk(text,'user');
    prompt.value='';
    setBusy(true,'Reading results…');
    try { await handle(text); }
    catch (err) {
      talk('I could not complete that request: '+err.message+
        ' You can inspect Jobs and Pipelines directly, or retry with two completed job IDs.');
    }
    finally { setBusy(false,'');prompt.focus(); }
  });
  talk('Ask me to compare PostgreSQL and MariaDB. I use only measured results in this HammerDB Web Service. No data is sent to an AI provider.');
})();
