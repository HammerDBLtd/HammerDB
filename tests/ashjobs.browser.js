// Real Chromium -> Wapp Jobs routes -> SQLite -> desktop ASH cursor replay.
// The local server contains explicitly synthetic samples, never a sampler.
// Start: tclsh tests/ashjobs-server.tcl 8097 /tmp/ash-browser-jobs.db
// Run: node tests/ashjobs.browser.js http://127.0.0.1:8097 /tmp/ash-artifacts
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const base = (process.argv[2] || 'http://127.0.0.1:8097').replace(/\/$/, '');
  const artifacts = path.resolve(process.argv[3] || '/tmp/ash-artifacts');
  await fs.mkdir(artifacts, {recursive: true});
  const browser = process.env.CHROMIUM_CDP_URL
    ? await chromium.connectOverCDP(process.env.CHROMIUM_CDP_URL)
    : await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, timezoneId: 'UTC',
    extraHTTPHeaders: {referer: `${base}/jobs`}});
  const page = await context.newPage();
  let content = page.mainFrame();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => requests.push(request.url()));
  let checks = 0;
  const section = title => content.locator('.hdb-ash-details > section').filter({has: content.getByRole('heading', {name: title, exact: true})});
  const waitRendered = () => content.waitForFunction(() => {
    const status = document.querySelector('.hdb-ash-status');
    return status && !status.textContent.includes('Loading');
  });
  const reportURL = url => url.pathname === '/jobs' && url.searchParams.has('ashdata');
  async function reportAfter(action, predicate = () => true) {
    const incoming = page.waitForResponse(response => {
      const url = new URL(response.url());
      return reportURL(url) && predicate(url);
    });
    await action();
    const response = await incoming;
    const report = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(report));
    content = page.frames().find(frame => {
      try {return new URL(frame.url()).searchParams.has('ash');} catch {return false;}
    }) || page.mainFrame();
    await waitRendered();
    return {report, url: new URL(response.url())};
  }
  async function open(id) {
    return reportAfter(() => page.goto(`${base}/jobs?jobid=${id}&ash`, {waitUntil: 'domcontentloaded'}));
  }
  async function oracle(id, report, url) {
    const query = new URLSearchParams({jobid: id, begin: report.begin, end: report.end});
    for (const name of ['sqlid', 'eventid', 'sessionid']) {
      if (url?.searchParams.has(name)) query.set(name, url.searchParams.get(name));
    }
    const response = await context.request.get(`${base}/test-oracle?${query}`);
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  }
  async function nativeDetails(id, report, url) {
    const expected = await oracle(id, report, url);
    for (const field of ['sql', 'sessions', 'events']) {
      assert.ok(Array.isArray(report[field]), `${field} must be a JSON array`);
      // Shares are calculated by the desktop helper outside its SQL cursor;
      // compare every native projection independently of Jobs report assembly.
      const rows = report[field].map(({percent, ...row}) => row);
      assert.deepEqual(rows, expected[field], `${field} differs from the desktop cursor for this exact window`);
    }
    for (const field of ['sql_stats', 'sql_overtime', 'event_sqls', 'sql_text']) {
      if (Object.hasOwn(expected, field)) assert.deepEqual(report[field], expected[field], `${field} differs from its desktop cursor`);
    }
    return expected;
  }
  async function check(label, run) {
    await run();checks += 1;console.log(`PASS: ${label}`);
  }
  try {
    assert.equal((await context.request.get(`${base}/test-control?action=reset`)).status(), 200);
    let initial;
    await check('Job index ASH link opens real persisted chart and native activity tables', async () => {
      await page.goto(`${base}/jobs?jobid=ASH-HISTORY&index`);
      const {report, url} = await reportAfter(() => page.getByRole('link', {name: 'ASH', exact: true}).click());
      initial = report;
      assert.equal(report.available, true);assert.equal(report.state, 'complete');
      assert.equal(report.sample_count, 10);
      assert.ok(report.chart.length >= 2, 'fixture must exercise at least two native chart refreshes');
      await content.locator('.hdb-ash-chart svg').waitFor();
      const titles = await content.locator('.hdb-ash-chart svg rect title').allTextContents();
      assert.equal(titles.length, report.chart.length);
      assert.deepEqual(titles, report.chart.map(row => `${row.category}: ${row.aas} AAS`), 'browser changed source categories or AAS');
      assert.ok((await content.locator('.hdb-ash-chart svg').boundingBox()).height > 100);
      assert.equal(await section('SQL activity').locator('tbody tr').count(), report.sql.length);
      await nativeDetails('ASH-HISTORY', report, url);
      await page.screenshot({path: path.join(artifacts, 'ash-historical.png'), fullPage: true});
    });
    await check('mouse drag reaches Jobs API and uses the native selected window results', async () => {
      const svg = content.locator('.hdb-ash-chart svg');
      const box = await svg.boundingBox();
      // Select within the second recorded bucket: q3 activity differs from
      // the full-window q1/q2/q3 population. Move a real mouse, no DOM events.
      const x = fraction => box.x + box.width * (60 + fraction * 925) / 1000;
      const {report, url} = await reportAfter(async () => {
        await page.mouse.move(x(.59), box.y + box.height * .4);
        await page.mouse.down();
        await page.mouse.move(x(.93), box.y + box.height * .55, {steps: 8});
        await page.mouse.up();
      });
      assert.ok(url.searchParams.has('pointer_begin') && url.searchParams.has('pointer_end'), 'drag must send pointer coordinates for shared desktop window resolution');
      assert.ok(Number(url.searchParams.get('pointer_begin')) < Number(url.searchParams.get('pointer_end')));
      assert.ok(Number.isFinite(report.begin) && Number.isFinite(report.end) && report.begin <= report.end);
      assert.notDeepEqual(report.sql, initial.sql, 'drag did not change the selected sample population');
      assert.deepEqual(report.sql.map(row => row.queryid), ['q3']);
      await nativeDetails('ASH-HISTORY', report, url);
      await page.screenshot({path: path.join(artifacts, 'ash-selected-window.png'), fullPage: true});
    });
    await check('event and SQL drilldowns use server cursors and show malicious SQL as inert text', async () => {
      const eventRow = section('Wait events').locator('tbody tr').filter({hasText: 'DataFileRead'});
      const event = await reportAfter(() => eventRow.getByRole('button', {name: 'View', exact: true}).click());
      assert.equal(event.url.searchParams.get('eventid'), 'DataFileRead');
      assert.ok(event.report.event_sqls.length > 0);
      await nativeDetails('ASH-HISTORY', event.report, event.url);
      assert.ok(await section('SQL statements for selected event').locator('tbody tr').count());
      const sqlRow = section('SQL activity').locator('tbody tr').filter({hasText: 'q3'});
      const sql = await reportAfter(() => sqlRow.getByRole('button', {name: 'View', exact: true}).click());
      assert.equal(sql.url.searchParams.get('sqlid'), 'q3');
      await nativeDetails('ASH-HISTORY', sql.report, sql.url);
      assert.match(await content.locator('.hdb-ash-sql').textContent(), /<img src=x onerror=/);
      assert.equal(await content.locator('.hdb-ash-sql img,.hdb-ash-sql script').count(), 0);
      assert.equal(await content.evaluate(() => window.__ashXSS), undefined);
      assert.ok(await section('SQL statistics (captured snapshots)').locator('tbody tr').count());
      assert.ok(await section('SQL activity over time').locator('tbody tr').count());
      await page.screenshot({path: path.join(artifacts, 'ash-sql-drilldown.png'), fullPage: true});
    });
    await check('session drilldown displays the selected native session identity and category statistics', async () => {
      const row = section('Session activity').locator('tbody tr').filter({hasText: '33'});
      await row.getByRole('button', {name: 'View', exact: true}).click();
      const detail = JSON.parse(await content.locator('.hdb-ash-sql').textContent());
      assert.equal(detail.pid, '33');
      const report = await (await context.request.get(`${base}/jobs?jobid=ASH-HISTORY&ashdata`)).json();
      // The row belongs to the current selected window, and retains the
      // exact native field values already displayed in its session table.
      for (const name of ['total', 'cpu', 'io']) assert.ok(Object.hasOwn(detail, name));
      assert.ok(report.sessions.some(session => session.pid === detail.pid));
    });
    await check('empty and uncollected Jobs show truthful states with no stale chart or SQL', async () => {
      const empty = await open('ASH-EMPTY');
      assert.equal(empty.report.available, true);assert.equal(empty.report.sample_count, 0);
      assert.match(await content.locator('.hdb-ash-status').textContent(), /No ASH samples have been transferred/);
      assert.equal(await content.locator('.hdb-ash-chart svg').count(), 0);
      const none = await open('ASH-NONE');
      assert.equal(none.report.available, false);
      assert.match(await content.locator('.hdb-ash-status').textContent(), /ASH was not collected/);
      assert.equal(await content.locator('.hdb-ash-chart svg').count(), 0);
      assert.equal((await content.locator('.hdb-ash-sql').textContent()).trim(), '');
    });
    await check('live polling incorporates a later transfer, stops after completion and replays saved history', async () => {
      await page.clock.install();
      const first = await open('ASH-LIVE');
      assert.equal(first.report.state, 'running');assert.equal(first.report.sample_count, 10);
      assert.equal((await context.request.get(`${base}/test-control?action=transfer`)).status(), 200);
      const transferred = await reportAfter(() => page.clock.fastForward(15001));
      assert.equal(transferred.report.state, 'running');assert.equal(transferred.report.sample_count, 15);
      assert.ok(transferred.report.chart.length > first.report.chart.length);
      assert.ok(transferred.report.sql.some(row => row.queryid === 'q4'));
      await nativeDetails('ASH-LIVE', transferred.report, transferred.url);
      assert.equal((await context.request.get(`${base}/test-control?action=complete`)).status(), 200);
      const completed = await reportAfter(() => page.clock.fastForward(15001));
      assert.equal(completed.report.state, 'complete');
      const count = requests.filter(value => reportURL(new URL(value))).length;
      await page.clock.fastForward(45001);
      assert.equal(requests.filter(value => reportURL(new URL(value))).length, count, 'polling continued after completion');
      const saved = await open('ASH-LIVE');
      assert.equal(saved.report.state, 'complete');assert.equal(saved.report.sample_count, 15);
      assert.deepEqual(saved.report.chart, completed.report.chart);
      assert.deepEqual(saved.report.sql, completed.report.sql);
      await page.screenshot({path: path.join(artifacts, 'ash-live-completed.png'), fullPage: true});
    });
    assert.deepEqual(errors, [], 'uncaught browser errors');
    assert.equal(await content.evaluate(() => window.__ashXSS), undefined);
    console.log(`PASS: ${checks} ASH browser integration checks; synthetic native rows, real Wapp/SQLite/replay/Chromium`);
  } catch (error) {
    await page.screenshot({path: path.join(artifacts, 'ash-browser-failure.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally {await context.close();await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode = 1;});
