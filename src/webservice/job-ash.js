/* Presentation only. All ASH queries, classifications and metrics run in Tcl. */
(() => {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';
  const finite = value => value !== '' && value != null && Number.isFinite(Number(value));
  const color = name => {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 58% 43%)`;
  };
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svgElement = (tag, attributes = {}) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const field = (row, ...names) => {
    const key = Object.keys(row).find(key => names.some(name => name.toLowerCase() === key.toLowerCase()));
    return key === undefined ? undefined : row[key];
  };
  const mount = root => {
    const source = new URL(root.dataset.source, location.href);
    if (source.origin !== location.origin) throw new Error('ASH data must use the same Jobs service.');
    const status = root.querySelector('.hdb-ash-status');
    const chart = root.querySelector('.hdb-ash-chart');
    const details = root.querySelector('.hdb-ash-details');
    const sqlText = root.querySelector('.hdb-ash-sql');
    const bounds = root.querySelector('.hdb-ash-window');
    const legend = root.querySelector('.hdb-ash-legend');
    const limitations = root.querySelector('.hdb-ash-limitations');
    let selection = {};
    let lastReport;
    let active;
    let timer;
    let generation = 0;
    let range;
    let display;
    const inputDate = epoch => {
      const date = new Date(epoch * 1000);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 23);
    };
    const setBounds = report => {
      for (const name of ['begin', 'end']) {
        const input = root.querySelector(`[data-bound="${name}"]`);
        if (finite(report[name]) && document.activeElement !== input) input.value = inputDate(Number(report[name]));
      }
      bounds.textContent = finite(report.begin) && finite(report.end)
        ? `${new Date(Number(report.begin) * 1000).toLocaleString()} — ${new Date(Number(report.end) * 1000).toLocaleString()}`
        : '';
    };
    const table = (title, rows, drill) => {
      const section = element('section');
      section.append(element('h3', title));
      if (!Array.isArray(rows) || !rows.length) {
        section.append(element('p', 'No captured data for this selection.'));
        details.append(section);
        return;
      }
      const keys = [...new Set(rows.flatMap(Object.keys))].filter(key => !key.startsWith('_'));
      const grid = element('table');
      const head = element('thead');
      const header = element('tr');
      for (const key of keys) header.append(element('th', key));
      if (drill) header.append(element('th', 'Details'));
      head.append(header); grid.append(head);
      const body = element('tbody');
      for (const row of rows) {
        const tr = element('tr');
        for (const key of keys) tr.append(element('td', row[key] == null ? 'Unavailable' : String(row[key])));
        if (drill) {
          const cell = element('td');
          const button = element('button', 'View'); button.type = 'button';
          button.addEventListener('click', () => drill(row)); cell.append(button); tr.append(cell);
        }
        body.append(tr);
      }
      grid.append(body); const scroll = element('div'); scroll.className = 'hdb-ash-scroll';
      scroll.append(grid); section.append(scroll); details.append(section);
    };
    const paint = report => {
      chart.replaceChildren(); legend.replaceChildren(); display = undefined;
      if (!Array.isArray(report.chart) || !report.chart.length) {
        chart.append(element('p', 'No captured chart refreshes are available. Raw samples are retained for analysis.'));
        return;
      }
      // Tcl supplies canonical epoch bucket bounds and native AAS. JavaScript
      // only stacks their rectangles; it never resamples or calculates scores.
      const points = report.chart.filter(row => finite(row.begin) && finite(row.end) && finite(row.aas));
      if (!points.length) return;
      const left = Math.min(...points.map(row => Number(row.begin)));
      const right = Math.max(...points.map(row => Number(row.end)));
      if (!(right > left)) return;
      range = [left, right];
      const stacked = new Map();
      let top = 1;
      const rects = points.map(row => {
        const key = `${row.begin}:${row.end}`;
        const bottom = stacked.get(key) || 0;
        const value = Number(row.aas);
        stacked.set(key, bottom + value);
        top = Math.max(top, bottom + value);
        return {row, bottom, value};
      });
      const cpu = finite(report.driver_cpucount) ? Number(report.driver_cpucount) : undefined;
      if (cpu !== undefined) top = Math.max(top, cpu);
      const width = 1000, height = 290, margin = {left: 60, right: 15, top: 15, bottom: 40};
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      const x = epoch => margin.left + (epoch - left) / (right - left) * plotWidth;
      const y = value => margin.top + plotHeight - value / top * plotHeight;
      const svg = svgElement('svg', {viewBox: `0 0 ${width} ${height}`, 'aria-label': 'Average active sessions by existing ASH event category'});
      svg.append(svgElement('line', {x1: margin.left, y1: y(0), x2: width - margin.right, y2: y(0), stroke: 'currentColor'}));
      for (let tick = 0; tick <= 4; tick++) {
        const value = top * tick / 4;
        const label = svgElement('text', {x: margin.left - 8, y: y(value) + 4, 'text-anchor': 'end'});
        label.textContent = value.toFixed(2); svg.append(label);
      }
      const categories = new Set();
      for (const {row, bottom, value} of rects) {
        const category = String(row.category || row.wait_event_type || 'Other');
        categories.add(category);
        const rect = svgElement('rect', {x: x(Number(row.begin)), y: y(bottom + value),
          width: Math.max(0, x(Number(row.end)) - x(Number(row.begin))),
          height: Math.max(0, y(bottom) - y(bottom + value)), fill: color(category)});
        const title = svgElement('title'); title.textContent = `${category}: ${row.aas} AAS`;
        rect.append(title); svg.append(rect);
      }
      for (const epoch of [left, right]) {
        const label = svgElement('text', {x: x(epoch), y: height - 10, 'text-anchor': epoch === left ? 'start' : 'end'});
        label.textContent = new Date(epoch * 1000).toLocaleString(); svg.append(label);
      }
      if (cpu !== undefined) {
        svg.append(svgElement('line', {x1: margin.left, y1: y(cpu), x2: width - margin.right,
          y2: y(cpu), stroke: 'currentColor', 'stroke-dasharray': '6 4'}));
        const label = svgElement('text', {x: margin.left + 5, y: y(cpu) - 5});
        label.textContent = `Driver-host CPU reference: ${report.driver_cpucount}`;
        svg.append(label);
      }
      const marker = svgElement('rect', {y: margin.top, height: plotHeight, fill: 'currentColor', opacity: '.15', 'pointer-events': 'none'});
      const selectedBegin = selection.pointer_begin ?? selection.begin;
      const selectedEnd = selection.pointer_end ?? selection.end;
      if (finite(selectedBegin) && finite(selectedEnd)) {
        marker.setAttribute('x', x(Math.max(left, selectedBegin)));
        marker.setAttribute('width', Math.max(0, x(Math.min(right, selectedEnd)) - x(Math.max(left, selectedBegin))));
      }
      svg.append(marker); chart.append(svg);
      for (const category of categories) {
        const label = element('span', category); label.style.borderLeftColor = color(category); legend.append(label);
      }
      const epochAt = clientX => {
        const box = svg.getBoundingClientRect();
        const coordinate = (clientX - box.left) / box.width * width;
        return left + Math.max(0, Math.min(1, (coordinate - margin.left) / plotWidth)) * (right - left);
      };
      let from;
      svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        from = epochAt(event.clientX); svg.setPointerCapture(event.pointerId);
      });
      svg.addEventListener('pointermove', event => {
        if (from === undefined) return;
        const to = epochAt(event.clientX);
        marker.setAttribute('x', x(Math.min(from, to)));
        marker.setAttribute('width', Math.abs(x(to) - x(from)));
      });
      svg.addEventListener('pointerup', event => {
        if (from === undefined) return;
        const to = epochAt(event.clientX);
        selection = {pointer_begin: Math.min(from, to), pointer_end: Math.max(from, to)};
        from = undefined;
        load();
      });
      svg.addEventListener('pointercancel', () => {from = undefined;});
      display = () => paint(lastReport);
    };
    const render = report => {
      lastReport = report; details.replaceChildren(); limitations.replaceChildren(); sqlText.textContent = '';
      if (!report.available) {status.textContent = report.message || 'ASH was not collected for this Job.'; chart.replaceChildren(); return;}
      status.textContent = `${report.state || 'saved'} · ${report.sample_count ?? 'unknown'} captured samples`;
      if (report.error) status.textContent += ` · ${report.error}`;
      if (report.message) status.textContent += ` · ${report.message}`;
      setBounds(report); paint(report);
      table('Wait events', report.events, row => {
        const event = field(row, 'wait_event');
        if (event !== undefined) {selection.event_id = event; load();}
      });
      table('SQL activity', report.sql, row => {
        const id = field(row, 'queryid', 'digest', 'query_id');
        // PostgreSQL supports the desktop's queryid IS NULL drill-down too.
        if (id !== undefined) {selection.sql_id = id; load();}
      });
      table('Session activity', report.sessions, row => {sqlText.textContent = JSON.stringify(row, null, 2);});
      table('SQL statistics (captured snapshots)', report.sql_stats);
      table('SQL statements for selected event', report.event_sqls);
      table('SQL activity over time', report.sql_overtime);
      if (report.sql_text) sqlText.textContent = report.sql_text;
      for (const message of report.limitations || []) limitations.append(element('li', message));
      if (report.state === 'running') timer = setTimeout(load, 15000);
    };
    async function load() {
      clearTimeout(timer);
      if (active) active.abort();
      active = new AbortController();
      const current = ++generation;
      const url = new URL(source);
      const parameters = {begin: 'begin', end: 'end', pointer_begin: 'pointer_begin', pointer_end: 'pointer_end', sql_id: 'sqlid', event_id: 'eventid'};
      for (const [key, value] of Object.entries(selection)) url.searchParams.set(parameters[key], String(value));
      const deadline = setTimeout(() => active?.abort(), 30000);
      try {
        const response = await fetch(url, {signal: active.signal, cache: 'no-store', credentials: 'same-origin'});
        const report = await response.json();
        if (current !== generation) return;
        if (!response.ok || report.error && !report.available) throw new Error(report.error || 'ASH data request failed.');
        render(report);
      } catch (error) {
        if (current !== generation) return;
        status.textContent = error.name === 'AbortError' ? 'ASH request timed out. Retry the selection.' : error.message;
      } finally {clearTimeout(deadline);}
    }
    root.querySelector('[data-action="reset"]').addEventListener('click', () => {
      selection = finite(lastReport?.captured_begin) && finite(lastReport?.captured_end)
        ? {begin: Number(lastReport.captured_begin), end: Number(lastReport.captured_end)} : {};
      load();
    });
    root.querySelector('[data-action="select"]').addEventListener('click', () => {
      const begin = Date.parse(root.querySelector('[data-bound="begin"]').value) / 1000;
      const end = Date.parse(root.querySelector('[data-bound="end"]').value) / 1000;
      if (!Number.isFinite(begin) || !Number.isFinite(end) || begin > end) {
        status.textContent = 'Choose a valid start time no later than the end time.'; return;
      }
      selection = {begin, end}; load();
    });
    window.addEventListener('pagehide', () => {clearTimeout(timer); active?.abort();});
    window.addEventListener('resize', () => {if (display) display();});
    load();
  };
  const start = () => document.querySelectorAll('[data-hdb-ash]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
