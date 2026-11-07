/* Historical presentation of existing Desktop ASH metrics and native cursors. */
(() => {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Exact Desktop vectorsetup palette, reordered for the legend (not reclassified).
  const PG_COLORS = [
    ['BCPU', '#00CC00'], ['CPU', '#00FF00'], ['IO', '#004AE7'],
    ['System_IO', '#4080F0'], ['Timeout', '#E46800'], ['IPC', '#FFD700'],
    ['Client', '#5C440B'], ['Extension', '#882044'], ['Activity', '#717354'],
    ['BufferPin', '#C02800'], ['Lock', '#9F9371'], ['LWLock', '#F06EAA']
  ];
  const MYSQL_COLORS = [
    ['BCPU', '#00CC00'], ['CPU', '#00FF00'], ['Idle', '#4080F0'],
    ['Lock', '#E46800'], ['Network', '#FFD700'], ['Table_IO', '#5C440B'],
    ['File_IO', '#882044'], ['SXLock', '#717354'], ['Cond', '#C02800'],
    ['RWLock', '#9F9371'], ['Mutex', '#F06EAA'], ['Other', '#808080']
  ];
  const num = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : 0;
  const valid = value => value !== '' && value != null && Number.isFinite(Number(value));
  const attr = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const svgNode = (tag, attrs = {}, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const field = (row, ...names) => {
    if (!row || typeof row !== 'object') return undefined;
    const match = Object.keys(row).find(key => names.some(n => n.toLowerCase().replace(/_/g, '') === key.toLowerCase().replace(/_/g, '')));
    return match === undefined ? undefined : row[match];
  };
  const label = value => value == null || value === '' ? 'Unavailable' : String(value);
  const timestamp = epoch => new Date(Number(epoch) * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const stampLong = epoch => new Date(Number(epoch) * 1000).toLocaleString();
  const round = value => num(value).toFixed(2);
  function mount(root) {
    const source = new URL(root.dataset.source, location.href);
    if (source.origin !== location.origin) throw new Error('ASH must load from the same Jobs service.');
    const chart = root.querySelector('.hdb-ash-chart');
    const legend = root.querySelector('.hdb-ash-legend');
    const status = root.querySelector('.hdb-ash-status');
    const bounds = root.querySelector('.hdb-ash-window');
    const inspector = root.querySelector('.hdb-ash-inspector-body');
    const inspectorTitle = root.querySelector('.hdb-ash-inspector-title');
    const limitations = root.querySelector('.hdb-ash-limitations');
    const workspace = root.querySelector('.hdb-ash-workspace');
    const hint = root.querySelector('.hdb-ash-hint');
    const panes = {
      sql: root.querySelector('[data-rows="sql"]'),
      events: root.querySelector('[data-rows="events"]'),
      sessions: root.querySelector('[data-rows="sessions"]')
    };
    let selection = {}, current = null, controller = null, timer = null, generation = 0;
    let view = 'sql-text', focus = 'sql', count = {sql: 50, events: 50, sessions: 50};
    let selectedID = null;
    const colorsFor = () => current && current.database === 'pg' ? PG_COLORS : MYSQL_COLORS;
    const key = name => String(name || 'Other').toLowerCase().replace(/_/g, '');
    const colorFor = name => (colorsFor().find(entry => key(entry[0]) === key(name)) || [null, '#8693A9'])[1];
    const category = row => label(field(row, 'category', 'group', 'wait_event_type'));
    function clearedWindow() {
      const next = {};
      for (const k of ['begin','end','pointer_begin','pointer_end'])
        if (Object.prototype.hasOwnProperty.call(selection, k)) next[k] = selection[k];
      return next;
    }
    function clearToRange() {
      selection = valid(current && current.captured_begin) && valid(current && current.captured_end)
        ? {begin: Number(current.captured_begin), end: Number(current.captured_end)} : {};
      focus = 'sql'; selectedID = null; view = 'sql-text'; load();
    }
    function selectRow(kind, row) {
      let id;
      if (kind === 'sql') id = field(row, 'queryid', 'digest', 'query_id');
      else if (kind === 'events') id = field(row, 'wait_event');
      else id = field(row, 'pid', 'processlist_id', 'session_id');
      // A NULL query ID is valid in the Desktop ASH SQL text cursor.
      // Avoid silently ignoring click events on such rows.
      if (kind === 'sql' && (id === null || id === undefined)) id = '';
      if (id === undefined || id === null) {
        status.textContent = 'Cannot open this '+kind+' row: no session/event identifier was captured.';
        inspector.replaceChildren(attr('p',{'class':'hdb-ash-empty'},status.textContent));
        return;
      }
      selection = clearedWindow();
      selection[kind === 'sql' ? 'sql_id' : kind === 'events' ? 'event_id' : 'session_id'] = id;
      focus = kind === 'events' ? 'event' : kind === 'sessions' ? 'session' : 'sql';
      selectedID = String(id);
      view = focus === 'sql' ? 'sql-text' : focus;
      const what = focus === 'event' ? 'wait event' : focus === 'session' ? 'session' : 'SQL statement';
      inspectorTitle.textContent = 'Details · '+(id === '' ? 'NULL SQL ID' : String(id));
      inspector.replaceChildren(attr('p',{'class':'hdb-ash-help'},'Loading '+what+' details from the saved ASH records…'));
      status.textContent = 'Loading '+what+' details…';
      load();
    }
    function legendPaint(rows) {
      legend.replaceChildren();
      const used = new Set(rows.map(r => key(category(r))));
      for (const [name, color] of colorsFor()) {
        if (!used.has(key(name))) continue;
        const swatch = attr('span', {'class': 'hdb-ash-legend-item'});
        swatch.append(attr('i', {'class': 'hdb-ash-swatch', 'style': 'background-color:' + color}), attr('span', {}, name));
        legend.append(swatch);
      }
    }
    function paintChart(report) {
      chart.replaceChildren();
      const points = (report.chart || []).filter(r => valid(r.begin) && valid(r.end) && valid(r.aas) && Number(r.end) > Number(r.begin));
      if (!points.length) {
        chart.append(attr('p', {'class': 'hdb-ash-empty'}, 'No chart samples were captured for this Job.'));
        legend.replaceChildren();
        return;
      }
      legendPaint(points);
      const left = Math.min(...points.map(r => Number(r.begin)));
      const right = Math.max(...points.map(r => Number(r.end)));
      if (!(right > left)) return;
      const WIDTH = 1160, HEIGHT = 278, m = {left: 54, right: 18, top: 20, bottom: 35};
      const pw = WIDTH - m.left - m.right, ph = HEIGHT - m.top - m.bottom;
      const byBucket = new Map();
      for (const row of points) {
        const start = num(row.begin), end = num(row.end);
        const k = String(start) + ':' + String(end);
        if (!byBucket.has(k)) byBucket.set(k, {start, end, groups: new Map()});
        const bucket = byBucket.get(k);
        const cls = category(row);
        bucket.groups.set(cls, (bucket.groups.get(cls) || 0) + Math.max(0, num(row.aas)));
      }
      const buckets = [...byBucket.values()].sort((a,b) => a.start-b.start);
      const ymax = Math.max(1, num(report.driver_cpucount), ...buckets.flatMap(b => [...b.groups.values()]));
      const top = Math.ceil(ymax / 5) * 5;
      const X = t => m.left + (t-left)/(right-left)*pw;
      const Y = value => m.top + ph - value/top*ph;
      const svg = svgNode('svg', {viewBox: '0 0 '+WIDTH+' '+HEIGHT, role: 'img', 'aria-label': 'Average active sessions, overlapping wait-class bars'});
      for (let i=0; i<=5; i++) {
        const value = top*i/5, y = Y(value);
        svg.append(svgNode('line', {x1:m.left,y1:y,x2:WIDTH-m.right,y2:y,stroke:'currentColor','stroke-opacity':'.18','stroke-dasharray':'2 5'}));
        svg.append(svgNode('text', {x:m.left-8,y:y+4,'text-anchor':'end'}, round(value)));
      }
      for (let i=0; i<=6; i++) {
        const t=left+(right-left)*i/6, x=X(t);
        svg.append(svgNode('line', {x1:x,y1:m.top,x2:x,y2:Y(0),stroke:'currentColor','stroke-opacity':'.12','stroke-dasharray':'2 5'}));
        svg.append(svgNode('text', {x:x,y:HEIGHT-11,'text-anchor':i===0?'start':i===6?'end':'middle'}, timestamp(t)));
      }
      // The Desktop uses overlaid bars (not additive stacking). Draw taller
      // categories first; short bars in front remain visible and readable.
      for (const bucket of buckets) {
        const x=X(bucket.start), width=Math.max(1,X(bucket.end)-x-.45);
        const sorted=[...bucket.groups].sort((a,b)=>b[1]-a[1]);
        for (const [cls,aas] of sorted) {
          if (aas<=0) continue;
          const rect=svgNode('rect',{x,y:Y(aas),width,height:Math.max(0,Y(0)-Y(aas)),fill:colorFor(cls),'class':'hdb-ash-bar'});
          rect.append(svgNode('title',{},cls+': '+round(aas)+' AAS · '+timestamp(bucket.start)+'–'+timestamp(bucket.end)));
          svg.append(rect);
        }
      }
      if (valid(report.driver_cpucount) && num(report.driver_cpucount)>0) {
        const n=num(report.driver_cpucount);
        svg.append(svgNode('line', {x1:m.left,y1:Y(n),x2:WIDTH-m.right,y2:Y(n),stroke:'#c7d3e3','stroke-dasharray':'7 5'}));
        svg.append(svgNode('text', {x:m.left+7,y:Y(n)-6}, 'Driver-host CPU reference: '+n));
      }
      const marker=svgNode('rect',{x:0,y:m.top,width:0,height:ph,fill:'#b9c9e7',opacity:'.18','pointer-events':'none'});
      const selectStart=Object.hasOwn(selection,'pointer_begin') ? Number(selection.pointer_begin) : Object.hasOwn(selection,'begin') ? Number(selection.begin) : null;
      const selectEnd=Object.hasOwn(selection,'pointer_end') ? Number(selection.pointer_end) : Object.hasOwn(selection,'end') ? Number(selection.end) : null;
      if (selectStart!==null && selectEnd!==null) {
        const a=Math.max(left,Math.min(right,selectStart)), b=Math.max(left,Math.min(right,selectEnd));
        marker.setAttribute('x', X(Math.min(a,b)));
        marker.setAttribute('width', Math.max(0, X(Math.max(a,b))-X(Math.min(a,b))));
      }
      svg.append(marker);
      let down = null;
      const epochAt = clientX => {
        const rect=svg.getBoundingClientRect();
        const logical=(clientX-rect.left)*WIDTH/rect.width;
        return left+Math.max(0,Math.min(1,(logical-m.left)/pw))*(right-left);
      };
      svg.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        down=epochAt(e.clientX); svg.setPointerCapture(e.pointerId);
      });
      svg.addEventListener('pointermove', e => {
        if (down===null) return;
        const end=epochAt(e.clientX);
        marker.setAttribute('x',X(Math.min(down,end)));
        marker.setAttribute('width',Math.abs(X(end)-X(down)));
      });
      svg.addEventListener('pointerup', e => {
        if (down===null) return;
        const end=epochAt(e.clientX), start=down; down=null;
        if (Math.abs(end-start)<(right-left)/350) return;
        selection={pointer_begin:Math.min(start,end),pointer_end:Math.max(start,end)};
        selectedID=null; focus='sql'; view='sql-text'; load();
      });
      svg.addEventListener('pointercancel',()=>{down=null;});
      svg.addEventListener('dblclick', clearToRange);
      chart.append(svg);
    }
    function barFor(row, kind, denominator) {
      const track=attr('span',{'class':'hdb-ash-activity-track','aria-hidden':'true'});
      const total=Math.max(0,num(field(row,'total'))), denom=Math.max(1,denominator);
      const segments=[];
      if (kind === 'events') {
        const cls=category(row);
        segments.push([cls,total]);
      } else {
        for (const [name] of colorsFor()) {
          const value=Math.max(0,num(field(row,name)));
          if (value>0) segments.push([name,value]);
        }
        if (!segments.length && total>0) segments.push(['Other',total]);
      }
      // The small bars are compositional: each native count retains the same
      // group colour as the chart. Absolute width uses the pane's max activity.
      const sum=segments.reduce((acc,item)=>acc+item[1],0);
      const scale=sum>total && sum>0 ? total/sum : 1;
      for(const [name,value] of segments) {
        const width=Math.min(100,Math.max(0,value*scale/denom*100));
        if(width<=0)continue;
        const slice=attr('span',{'class':'hdb-ash-activity-slice','style':'width:'+width+'%;background-color:'+colorFor(name),'title':name+': '+value});
        track.append(slice);
      }
      return track;
    }
    function paintPane(kind, rows) {
      const parent=panes[kind]; parent.replaceChildren();
      if(!Array.isArray(rows)||!rows.length) {
        parent.append(attr('p',{'class':'hdb-ash-empty'},'No ASH activity in this selection.'));
        return;
      }
      const max=Math.max(1,...rows.map(r=>num(field(r,'total'))));
      const limit=count[kind];
      for(const row of rows.slice(0,limit)) {
        const main=attr('span',{'class':'hdb-ash-row-main'});
        const id=kind==='sql' ? field(row,'queryid','digest','query_id')
          :kind==='events'?field(row,'wait_event'):field(row,'pid','processlist_id','session_id');
        let title;
        if(kind==='sql') title=id===undefined||id===''?'NULL SQL ID':String(id);
        else if(kind==='sessions') title=label(field(row,'usename','user','username'))+' · PID '+label(id);
        else title=label(id);
        main.append(attr('span',{'class':'hdb-ash-row-label','title':title},title));
        if(kind==='sql')main.append(attr('span',{'class':'hdb-ash-row-type'},label(field(row,'cmdtype','sql_type','command'))));
        if(kind==='events')main.append(attr('span',{'class':'hdb-ash-row-type'},label(field(row,'wait_event_type'))));
        const value=attr('span',{'class':'hdb-ash-row-percent'},valid(row.percent)?String(row.percent)+'%':'');
        const lower=attr('span',{'class':'hdb-ash-row-lower'});
        lower.append(barFor(row,kind,max),value);
        const button=attr('button',{'class':'hdb-ash-row','type':'button','aria-label':'View '+kind+' '+title});
        button.append(main,lower);
        const active=(kind==='sql' && focus==='sql' && String(id)===String(selectedID)) ||
          (kind==='events' && focus==='event' && String(id)===String(selectedID)) ||
          (kind==='sessions' && focus==='session' && String(id)===String(selectedID));
        if(active)button.setAttribute('aria-pressed','true');
        button.addEventListener('click',()=>selectRow(kind,row));
        parent.append(button);
      }
      if(rows.length>limit) {
        const more=attr('button',{'type':'button','class':'hdb-ash-more'},'Show more ('+(rows.length-limit)+' remaining)');
        more.addEventListener('click',()=>{count[kind]+=50;paintPane(kind,rows);});
        parent.append(more);
      }
    }
    function addText(parent,text,cls) {parent.append(attr('p',cls?{'class':cls}:{},text));}
    function addCode(parent,text) {parent.append(attr('pre',{'class':'hdb-ash-code'},text));}
    function addMetric(parent,name,value) {
      const row=attr('div',{'class':'hdb-ash-metric'});
      row.append(attr('span',{},name),attr('strong',{},label(value)));
      parent.append(row);
    }
    function addTable(parent,rows,keys) {
      const table=attr('table',{'class':'hdb-ash-stat-table'}), head=attr('thead'), tr=attr('tr');
      for(const key of keys)tr.append(attr('th',{},key.replace(/_/g,' ')));
      head.append(tr);table.append(head);
      const body=attr('tbody');
      for(const row of rows) {
        const line=attr('tr');
        for(const key of keys)line.append(attr('td',{},label(field(row,key))));
        body.append(line);
      }
      table.append(body);
      const scroll=attr('div',{'class':'hdb-ash-stat-scroll'});scroll.append(table);parent.append(scroll);
    }
    function overtime(parent,rows) {
      if(!rows||!rows.length)return;
      const validRows=rows.filter(r=>valid(r.last_id)&&valid(r.aas));
      if(!validRows.length)return;
      parent.append(attr('h4',{},'Selected SQL activity over time'));
      const byTime=new Map();
      for(const row of validRows) {
        const t=num(row.last_id), group=category(row);
        if(!byTime.has(t))byTime.set(t,new Map());
        const categories=byTime.get(t);categories.set(group,(categories.get(group)||0)+num(row.aas));
      }
      const times=[...byTime.keys()].sort((a,b)=>a-b);
      const w=800,h=175,l=38,t=12,b=34,r=10,plotW=w-l-r,plotH=h-t-b;
      const ymax=Math.max(1,...times.flatMap(time=>[...byTime.get(time).values()]));
      const x=i=>l+(i+.5)*plotW/times.length, y=n=>t+plotH-n/ymax*plotH;
      const svg=svgNode('svg',{viewBox:'0 0 '+w+' '+h,role:'img','aria-label':'SQL activity over time by wait class'});
      for(let i=0;i<=3;i++) {
        const value=ymax*i/3,yp=y(value);
        svg.append(svgNode('line',{x1:l,y1:yp,x2:w-r,y2:yp,stroke:'currentColor','stroke-opacity':'.18','stroke-dasharray':'2 4'}));
        svg.append(svgNode('text',{x:l-5,y:yp+4,'text-anchor':'end'},round(value)));
      }
      const bw=Math.max(2,plotW/times.length-2);
      times.forEach((time,i)=>{
        const groups=[...byTime.get(time)].sort((a,b)=>b[1]-a[1]);
        for(const [name,aas] of groups) {
          const rect=svgNode('rect',{x:x(i)-bw/2,y:y(aas),width:bw,height:Math.max(0,y(0)-y(aas)),fill:colorFor(name)});
          rect.append(svgNode('title',{},timestamp(time)+' · '+name+': '+round(aas)+' AAS'));svg.append(rect);
        }
      });
      for(const i of new Set([0,times.length-1]))svg.append(svgNode('text',{x:x(i),y:h-10,'text-anchor':i===0?'start':'end'},timestamp(times[i])));
      const wrap=attr('div',{'class':'hdb-ash-overtime'});wrap.append(svg);parent.append(wrap);
    }
    function inspect() {
      if(!current)return;
      inspector.replaceChildren();
      inspectorTitle.textContent=focus==='event'?'Wait event details':focus==='session'?'Session details':'SQL and activity details';
      const tabset=root.querySelector('.hdb-ash-tabs');
      tabset.querySelectorAll('[data-ash-dynamic]').forEach(n=>n.remove());
      if(focus==='event'||focus==='session') {
        const button=attr('button',{'type':'button','data-ash-dynamic':'1','data-ash-tab':focus},focus==='event'?'Event details':'Session details');
        button.addEventListener('click',()=>{view=focus;inspect();});tabset.prepend(button);
      }
      for(const b of tabset.querySelectorAll('button[data-ash-tab]')) {
        const active=b.dataset.ashTab===view;
        b.setAttribute('aria-pressed',active?'true':'false');
        b.setAttribute('aria-selected',active?'true':'false');
      }
      const r=current;
      if(view==='event') {
        addMetric(inspector,'Wait event',selectedID);
        const events=(r.events||[]).find(row=>String(field(row,'wait_event'))===String(selectedID));
        if(events) {
          addMetric(inspector,'Category',field(events,'wait_event_type'));
          addMetric(inspector,'Samples',field(events,'total'));
          addMetric(inspector,'DB time',label(events.percent)+'%');
        }
        const statements=r.event_sqls||[];
        inspector.append(attr('h4',{},'SQL statements waiting on this event'));
        if(statements.length) {
          for(const row of statements) {
            const block=attr('div',{'class':'hdb-ash-event-sql'});
            addMetric(block,'Samples',field(row,'total'));
            addMetric(block,'Backend',field(row,'backend_type'));
            addCode(block,label(field(row,'query','sql_text')));
            inspector.append(block);
          }
        } else addText(inspector,'No captured SQL statements for this event.','hdb-ash-empty');
      } else if(view==='session') {
        addMetric(inspector,'Session ID',selectedID);
        const row=(r.session_details||[])[0];
        if(!row)addText(inspector,'No saved samples for this session in the selected time window.','hdb-ash-empty');
        else {
          for(const name of ['usename','application_name','pid','total','percent'])
            if(field(row,name)!==undefined)addMetric(inspector,name.replace(/_/g,' '),field(row,name));
          inspector.append(attr('h4',{},'Time spent by wait class'));
          inspector.append(barFor(row,'sessions',Math.max(1,num(field(row,'total')))));
          addTable(inspector,[row],colorsFor().map(([name])=>name).filter(name=>field(row,name)!==undefined));
        }
      } else if(view==='sql-text') {
        addMetric(inspector,'SQL ID',selection.sql_id===undefined?'Select a SQL statement':selection.sql_id===''?'NULL':selection.sql_id);
        if(r.sql_text)addCode(inspector,r.sql_text);
        else addText(inspector,selection.sql_id!==undefined?'No SQL text was captured for this statement.':'Select a SQL statement to see its captured text.','hdb-ash-empty');
        overtime(inspector,r.sql_overtime);
      } else if(view==='sql-io') {
        const rows=(r.sql_io && r.sql_io.length) ? r.sql_io :
          (r.events||[]).filter(row=>key(category(row))==='io');
        inspector.append(attr('h4',{},'Recorded I/O waits'));
        if(!rows.length)addText(inspector,'No captured I/O waits for this selection.','hdb-ash-empty');
        else addTable(inspector,rows,['wait_event','total']);
        overtime(inspector,r.sql_overtime);
      } else if(view==='sql-stats') {
        const rows=r.sql_statistics&&r.sql_statistics.length?r.sql_statistics:[];
        if(rows.length)addTable(inspector,rows,['statistic','total','per_exec','per_row']);
        else addText(inspector,selection.sql_id!==undefined?'No SQL statistics snapshot was captured for this statement.':'Select a SQL statement to view its captured statistics.','hdb-ash-empty');
      } else if(view==='sql-plan') {
        if(r.sql_plan)addCode(inspector,r.sql_plan);
        else addText(inspector,selection.sql_id===undefined?'Select a SQL statement to view an archived execution plan.':r.plan_status||'No execution plan was captured for this SQL ID.','hdb-ash-empty');
      } else if(view==='cpu') {
        addMetric(inspector,'Driver-host CPU reference',r.driver_cpucount);
        addMetric(inspector,'Captured ASH samples',r.sample_count);
        addMetric(inspector,'Selected ASH samples',r.selected_sample_count);
        addText(inspector,'This is the benchmark driver-host CPU reference from the Desktop metrics path, not database host utilisation.','hdb-ash-help');
        const cpu=(r.events||[]).filter(row=>key(category(row))==='cpu'||key(category(row))==='bcpu');
        if(cpu.length)addTable(inspector,cpu,['wait_event','total','percent']);
      }
    }
    async function load() {
      if(timer)clearTimeout(timer);
      if(controller)controller.abort();
      const request=new AbortController();controller=request;
      const thisCall=++generation;
      const url=new URL(source);
      const parameter={begin:'begin',end:'end',pointer_begin:'pointerbegin',pointer_end:'pointerend',sql_id:'sqlid',event_id:'eventid',session_id:'sessionid'};
      for(const [key,value] of Object.entries(selection))url.searchParams.set(parameter[key],String(value));
      const deadline=setTimeout(()=>request.abort(),30000);
      try {
        const reply=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:request.signal});
        const report=await reply.json();
        if(thisCall!==generation)return;
        if(!reply.ok||(report.error&&!report.available))throw new Error(report.error||'ASH report request failed.');
        render(report);
      } catch(error) {
        if(thisCall!==generation)return;
        const message = error.name==='AbortError'?'ASH request timed out.':String(error.message);
        status.textContent=message;
        inspector.replaceChildren(attr('p',{'class':'hdb-ash-empty'},'Unable to load ASH details: '+message));
      } finally {clearTimeout(deadline);}
    }
    function render(report) {
      current=report;
      const available=!!report.available;
      root.classList.toggle('hdb-ash-unavailable',!available);
      status.textContent=available ?
        (String(report.state||'saved')+' · '+label(report.sample_count)+' captured samples'+(report.error?' · '+report.error:'')+(report.message?' · '+report.message:'')) :
        (report.message||'ASH was not collected for this Job.');
      if(!available) {
        chart.replaceChildren();legend.replaceChildren();bounds.textContent='';
        workspace.hidden=true;hint.hidden=true;limitations.replaceChildren();return;
      }
      workspace.hidden=false;hint.hidden=false;
      const selecting=Object.hasOwn(selection,'pointer_begin')||Object.hasOwn(selection,'begin');
      bounds.textContent=selecting&&valid(report.begin)&&valid(report.end) ?
        'Selected · '+stampLong(report.begin)+' — '+stampLong(report.end) : '';
      paintChart(report);
      paintPane('sql',report.sql);
      paintPane('events',report.events);
      paintPane('sessions',report.sessions);
      inspect();
      limitations.replaceChildren();
      for(const message of report.limitations||[])
        limitations.append(attr('li',{},message));
      if(report.state==='running')timer=setTimeout(load,15000);
    }
    for(const button of root.querySelectorAll('[data-ash-tab]'))button.addEventListener('click',()=>{view=button.dataset.ashTab;inspect();});
    window.addEventListener('pagehide',()=>{if(timer)clearTimeout(timer);if(controller)controller.abort();});
    load();
  }
  function start(){document.querySelectorAll('[data-hdb-ash]').forEach(mount);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();