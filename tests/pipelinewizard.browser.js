// Stage 1 UI integration checks. Use an isolated Web Service with no CI listener.
// Usage: node tests/pipelinewizard.browser.js http://127.0.0.1:8080 /workspace/artifacts
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const base = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const artifacts = path.resolve(process.argv[3] || '/workspace/artifacts');
  await fs.mkdir(artifacts, {recursive: true});
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  const page = await context.newPage();
  const errors = [];
  const forbiddenRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/cihook') || url.searchParams.get('action') === 'run' || request.method() !== 'GET') {
      forbiddenRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  let checks = 0;
  async function check(label, work) {
    await work(); checks += 1; console.log(`PASS: ${label}`);
  }
  async function open(database = 'pg', workload = 'C', location = 'remote') {
    await page.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
    await page.locator('#wizard-form').waitFor({state: 'visible'});
    await page.locator(`input[name=location][value=${location}]`).check();
    await page.selectOption('#wizard-database', database);
    await page.selectOption('#wizard-workload', workload);
  }
  async function connection() {
    await page.locator('#wizard-next').click();
    await page.locator('[data-wizard-step="1"]').waitFor({state: 'visible'});
    await page.locator('#wizard-profile').fill('test-operator-profile');
  }
  async function benchmark() {
    await page.locator('#wizard-next').click();
    await page.locator('[data-wizard-step="2"]').waitFor({state: 'visible'});
  }
  async function review() {
    await page.locator('#wizard-next').click();
    await page.locator('[data-wizard-step="3"]').waitFor({state: 'visible'});
    return JSON.parse(await page.locator('#wizard-request-json').textContent());
  }
  async function screenshot(name) {
    await page.evaluate(() => {document.activeElement?.blur(); window.scrollTo(0, 0);});
    await page.screenshot({path: path.join(artifacts, name), fullPage: true});
  }
  try {
    await check('location switching and existing Pipeline handoff preserve navigation', async () => {
      await open();
      await screenshot('wizard-target-desktop.png');
      assert.equal(await page.locator('#wizard-local-mode').isVisible(), false);
      await page.locator('input[name=location][value=local]').check();
      assert.equal(await page.locator('#wizard-local-mode').isVisible(), true);
      await page.locator('input[name=target_mode][value=source]').check();
      assert.equal(await page.locator('#wizard-source-help').isVisible(), true);
      await page.locator('#wizard-existing-link').click();
      assert.equal(await page.locator('#existing-pipeline').getAttribute('open'), '');
      assert.equal(await page.locator('#runform').count(), 1);
      assert.equal(await page.locator('#runform input[name=action]').inputValue(), 'run');
      assert.ok(await page.locator('a[href$="/jobs"]').count());
      assert.ok(await page.locator('a[href$="/pipelines"]').count());
    });

    await check('endpoint and source targets expose one active set of workload and execution controls', async () => {
      const source = page.locator('#existing-pipeline');
      const originalWorkload = page.locator('#existing-pipeline input[name=bench][value=h_single]');
      const originalRun = page.locator('#runform button[type=submit]');
      const originalDatabase = page.locator('#existing-pipeline select[name=db]');
      async function expectEndpoint() {
        assert.equal(await source.isVisible(), false, 'source workflow must not compete with endpoint configuration');
        assert.equal(await originalWorkload.isVisible(), false);
        assert.equal(await originalWorkload.isDisabled(), true);
        assert.equal(await originalRun.isVisible(), false);
        assert.equal(await originalRun.isDisabled(), true);
        assert.equal(await originalDatabase.isDisabled(), true);
        assert.equal(await page.locator('#wizard-endpoint-choice').isVisible(), true);
        assert.equal(await page.locator('#wizard-workload').isDisabled(), false);
        assert.equal(await page.locator('#wizard-next').isVisible(), true);
        assert.equal(await source.locator('#pipeline-activity').count(), 0,
          'read-only Activity must stay outside the target-specific source controls');
        assert.equal(await page.locator('#pipeline-activity').isVisible(), true);
      }
      async function expectSource() {
        assert.equal(await source.isVisible(), true);
        assert.equal(await originalWorkload.isVisible(), true);
        assert.equal(await originalWorkload.isDisabled(), false);
        assert.equal(await originalRun.isVisible(), true);
        assert.equal(await originalRun.isDisabled(), false);
        assert.equal(await originalDatabase.isDisabled(), false);
        assert.equal(await page.locator('#wizard-endpoint-choice').isVisible(), false);
        assert.equal(await page.locator('#wizard-workload').isDisabled(), true);
        assert.equal(await page.locator('#wizard-next').isVisible(), false);
        assert.equal(await source.locator('#pipeline-activity').count(), 0);
        assert.equal(await page.locator('#pipeline-activity').isVisible(), true);
      }

      // Default: already-running local database, with no second source form.
      await page.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
      await page.locator('#wizard-form').waitFor({state: 'visible'});
      assert.equal(await page.locator('input[name=location][value=local]').isChecked(), true);
      assert.equal(await page.locator('input[name=target_mode][value=existing]').isChecked(), true);
      await expectEndpoint();

      // Reproduce the user-reported sequence and verify each target transition.
      await page.locator('input[name=location][value=remote]').check();
      await expectEndpoint();
      await page.locator('input[name=location][value=local]').check();
      await page.locator('input[name=target_mode][value=source]').check();
      await expectSource();
      await originalWorkload.check();
      assert.equal(await page.locator('#workload_hidden').inputValue(), 'H');
      await screenshot('wizard-source-desktop.png');
      await page.locator('input[name=target_mode][value=existing]').check();
      await expectEndpoint();
      await page.locator('input[name=location][value=remote]').check();
      await expectEndpoint();
      await screenshot('wizard-endpoint-desktop.png');

      // The original provider selector reloads ?db=...; it must remain in the
      // source path instead of reintroducing the endpoint controls on reload.
      await page.locator('input[name=location][value=local]').check();
      await page.locator('input[name=target_mode][value=source]').check();
      await expectSource();
      await Promise.all([
        page.waitForURL(url => url.searchParams.get('db') === 'pg'),
        originalDatabase.selectOption('pg')
      ]);
      await page.locator('#wizard-form').waitFor({state: 'visible'});
      assert.equal(await page.locator('input[name=location][value=local]').isChecked(), true);
      assert.equal(await page.locator('input[name=target_mode][value=source]').isChecked(), true);
      assert.equal(await originalDatabase.inputValue(), 'pg');
      await expectSource();
    });

    await check('all seven databases and both workloads reach credential-free request review', async () => {
      for (const database of ['ora', 'mssqls', 'db2', 'mysql', 'maria', 'pg', 'vsql']) {
        for (const workload of ['C', 'H']) {
          await open(database, workload);
          await connection();
          assert.equal(await page.locator('#wizard-form input[type=password]').count(), 0);
          await benchmark();
          assert.equal(await page.locator('#wizard-share-result').isChecked(), true);
          const request = await review();
          assert.equal(request.database, database);
          assert.equal(request.workload, workload);
          assert.equal(request.target.mode, 'existing');
          assert.equal(request.target.location, 'remote');
          assert.deepEqual(request.operations, ['checkschema', 'run']);
          assert.equal(request.share_result, true);
          assert.equal(request.diset[workload === 'C' ? 'tpch' : 'tpcc'], undefined);
        }
      }
    });

    await check('required connection profile prevents progression and keyboard focuses the error', async () => {
      await open();
      await page.locator('#wizard-next').click();
      await page.locator('[data-wizard-step="1"]').waitFor({state: 'visible'});
      await page.locator('#wizard-profile').fill('');
      await page.locator('#wizard-next').click();
      assert.equal(await page.locator('[data-wizard-step="1"]').isVisible(), true);
      assert.equal(await page.locator('#wizard-error').isVisible(), true);
      assert.equal(await page.locator('#wizard-error').evaluate(el => document.activeElement === el), true);
      await page.locator('#wizard-profile').fill('test-operator-profile');
      await benchmark();
    });

    await check('manual AVU slider and numeric input stay in sync; sharing can be disabled', async () => {
      await open('pg', 'C', 'remote'); await connection(); await benchmark();
      await page.locator('input[name=avu_mode][value=manual]').check();
      await page.locator('#wizard-max-avu').fill('16');
      await page.locator('#wizard-max-avu').dispatchEvent('input');
      assert.equal(await page.locator('#wizard-avu-slider').inputValue(), '16');
      await page.locator('#wizard-avu-slider').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#wizard-max-avu').inputValue(), '17');
      await page.locator('#wizard-driver-vu').fill('4');
      await page.locator('#wizard-share-result').uncheck();
      await page.locator('#wizard-advanced summary').click();
      assert.equal(await page.locator('#wizard-advanced').getAttribute('open'), '');
      const request = await review();
      assert.equal(request.max_avu.mode, 'manual');
      assert.equal(request.max_avu.maximum, 17);
      assert.equal(request.vuset.vu, 4);
      assert.equal(request.share_result, false);
      await screenshot('wizard-review-desktop.png');
      await page.locator('#wizard-preview').click();
      assert.match(await page.locator('#wizard-status').textContent(), /not submitted|no.*submitted|preview/i);
      assert.equal(await page.locator('#wizard-status').evaluate(el => document.activeElement === el), true);
    });

    await check('delete requires exact endpoint/schema confirmation; changing the endpoint invalidates it', async () => {
      await open('pg', 'C', 'local'); await connection(); await benchmark();
      await page.locator('input[name=workflow][value=operations]').check();
      for (const operation of ['checkschema', 'run'])
        await page.locator(`input[name=operation][value=${operation}]`).uncheck();
      await page.locator('input[name=operation][value=deleteschema]').check();
      assert.equal(await page.locator('#wizard-delete-confirmation').isVisible(), true);
      await page.locator('#wizard-next').click();
      assert.equal(await page.locator('[data-wizard-step="2"]').isVisible(), true);
      const target = (await page.locator('#wizard-delete-target').textContent()).trim();
      await page.locator('#wizard-delete-text').fill(target);
      await page.locator('#wizard-confirm-delete').check();
      const request = await review();
      assert.deepEqual(request.operations, ['deleteschema']);
      await page.locator('#wizard-back').click(); await page.locator('#wizard-back').click();
      await page.locator('[data-native-field="pg_dbase"]').fill('changed_schema');
      await benchmark();
      await page.locator('#wizard-next').click();
      assert.equal(await page.locator('[data-wizard-step="2"]').isVisible(), true);
    });

    await check('individual build, check and run operations produce only the chosen operation', async () => {
      for (const operation of ['buildschema', 'checkschema', 'run']) {
        await open(); await connection(); await benchmark();
        await page.locator('input[name=workflow][value=operations]').check();
        for (const candidate of ['buildschema', 'checkschema', 'run', 'deleteschema']) {
          const checkbox = page.locator(`input[name=operation][value=${candidate}]`);
          if (candidate === operation) await checkbox.check(); else await checkbox.uncheck();
        }
        if (operation === 'buildschema') await page.locator('#wizard-confirm-build').check();
        const request = await review();
        assert.deepEqual(request.operations, [operation]);
        assert.equal(Boolean(request.vuset), operation === 'run');
      }
    });

    await check('mock capabilities expose only listed workloads and mark unavailable clients as preview', async () => {
      await page.route('**/pipeline-wizard-config', async route => {
        const response = await route.fetch();
        const data = await response.json();
        const pg = data.databases.find(db => db.id === 'pg');
        delete pg.workloads.H; pg.library_status = 'unavailable';
        await route.fulfill({response, json: data});
      });
      try {
        await open();
        assert.deepEqual(await page.locator('#wizard-workload option').evaluateAll(options => options.map(o => o.value)), ['C']);
        assert.match(await page.locator('#wizard-library-status').textContent(), /unavailable.*preview/i);
      } finally {await page.unroute('**/pipeline-wizard-config');}
    });

    await check('metadata failure and disabled JavaScript retain the original source workflow only', async () => {
      await page.route('**/pipeline-wizard-config', route => route.fulfill({status: 503, body: 'Unavailable'}));
      try {
        await page.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
        await page.getByText('Wizard configuration is unavailable. The existing Pipeline controls remain available below.', {exact: true})
          .waitFor({state: 'visible'});
        assert.equal(await page.locator('#wizard-form').isVisible(), false);
        assert.equal(await page.locator('#existing-pipeline').isVisible(), true);
        assert.equal(await page.locator('#runform button[type=submit]').isDisabled(), false);
      } finally {await page.unroute('**/pipeline-wizard-config');}

      const noScriptContext = await browser.newContext({javaScriptEnabled: false});
      try {
        const noScript = await noScriptContext.newPage();
        await noScript.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
        assert.equal(await noScript.locator('#wizard-form').isVisible(), false);
        assert.equal(await noScript.locator('#existing-pipeline').isVisible(), true);
        assert.equal(await noScript.locator('#runform button[type=submit]').isVisible(), true);
        assert.equal(await noScript.locator('#runform button[type=submit]').isDisabled(), false);
      } finally {await noScriptContext.close();}
    });

    await check('an in-progress request survives the existing periodic page refresh', async () => {
      await page.clock.install();
      await open(); await connection();
      const before = page.url();
      assert.equal(await page.locator('#hdb-pipeline-wizard').getAttribute('data-dirty'), 'true');
      await page.clock.fastForward(120001);
      assert.equal(page.url(), before);
      assert.equal(await page.locator('#wizard-profile').inputValue(), 'test-operator-profile');
      assert.equal(await page.locator('[data-wizard-step="1"]').isVisible(), true);
    });

    await check('mobile layout and keyboard navigation retain visible controls and review', async () => {
      await page.setViewportSize({width: 390, height: 844});
      await open('pg', 'H', 'remote');
      await page.locator('input[name=location][value=remote]').focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('input[name=location][value=local]').isChecked(), true);
      await connection(); await benchmark();
      assert.equal(await page.locator('#wizard-share-result').isChecked(), true);
      await review();
      const widths = await page.locator('#hdb-pipeline-wizard').evaluate(el => ({client: el.clientWidth, scroll: el.scrollWidth}));
      assert.ok(widths.scroll <= widths.client + 1, `wizard overflow: ${JSON.stringify(widths)}`);
      await screenshot('wizard-review-mobile.png');
    });

    assert.deepEqual(forbiddenRequests, [], 'the Stage 1 wizard attempted to submit work');
    assert.deepEqual(errors, [], 'browser JavaScript exceptions');
    console.log(`PASS: ${checks} browser checks; no CI submissions, benchmarks or GitHub writes`);
  } catch (error) {
    await page.screenshot({path: path.join(artifacts, 'wizard-browser-failure.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally {await browser.close();}
}

main().catch(error => {console.error(error); process.exitCode = 1;});
