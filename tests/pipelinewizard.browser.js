// Stage 1 Wapp/browser checks with browser-only simulation fixtures; no live CI.
// Usage: node tests/pipelinewizard.browser.js http://127.0.0.1:8080 /workspace/artifacts
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const SECRET = 'WIZARD_SESSION_SENTINEL_$[];2026';

async function main() {
  const base = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const artifacts = path.resolve(process.argv[3] || '/workspace/artifacts');
  await fs.mkdir(artifacts, {recursive: true});
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  await context.addInitScript(() => {
    window.__wizardMockCalls = [];
    let installed;
    Object.defineProperty(window, 'HammerDBWizardMock', {
      configurable: true, get: () => installed,
      set(api) {
        const create = api.createAdapter;
        installed = {...api, createAdapter(options) {
          const adapter = create.call(api, options);
          return new Proxy(adapter, {get(target, key) {
            if (typeof target[key] !== 'function') return target[key];
            return async (...args) => {
              const call = {method: key, args: JSON.parse(JSON.stringify(args)), scenario: options?.scenario};
              window.__wizardMockCalls.push(call);
              try {call.result = await target[key](...args); return call.result;}
              catch (error) {call.error = {code: error.code, status: error.status}; throw error;}
            };
          }});
        }};
      }
    });
  });
  const page = await context.newPage();
  const errors = [];
  const forbiddenRequests = [];
  const consoleMessages = [];
  const sourceCaptures = [];
  let captureSource = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => consoleMessages.push(message.text()));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.ok(!url.href.includes(SECRET) && !(request.postData() || '').includes(SECRET), 'credential escaped into a network request');
    if (captureSource && url.pathname.endsWith('/pipelines') && url.searchParams.get('action') === 'run') {
      sourceCaptures.push(Object.fromEntries(url.searchParams));
      await route.fulfill({contentType: 'text/html', body: '<p>Source form intercepted; no CI request sent.</p>'});
      return;
    }
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
    assert.equal(await page.locator('input[name=credential_mode][value=session]').isChecked(), true);
    await fillSecrets();
  }
  async function fillSecrets() {
    const inputs = page.locator('#wizard-form input[type=password]:enabled');
    for (let index = 0; index < await inputs.count(); index++) await inputs.nth(index).fill(SECRET, {force: true});
  }
  async function benchmark() {
    await page.locator('#wizard-next').click();
    await page.locator('[data-wizard-step="2"]').waitFor({state: 'visible'});
  }
  async function review() {
    await page.locator('#wizard-next').click();
    await page.locator('[data-wizard-step="3"]').waitFor({state: 'visible'});
    const displayed = JSON.parse(await page.locator('#wizard-request-json').textContent());
    assert.ok(!JSON.stringify(displayed).includes(SECRET), 'review exposed a session credential');
    // Inspect the actual proposed request separately from the intentionally
    // redacted review JSON; buildRequest emits references, never raw secrets.
    return page.evaluate(() => document.querySelector('#hdb-pipeline-wizard').wizard.buildRequest());
  }
  async function screenshot(name) {
    await page.evaluate(() => {document.activeElement?.blur(); window.scrollTo(0, 0);});
    await page.screenshot({path: path.join(artifacts, name), fullPage: true});
  }
  async function freshBenchmark(database = 'pg', workload = 'C', location = 'remote') {
    await open(database, workload, location); await connection(); await benchmark();
  }
  async function metadataOverride(change, work) {
    await page.route('**/pipeline-wizard-config', async route => {
      const response = await route.fetch(); const data = await response.json(); change(data);
      await route.fulfill({response, json: data});
    });
    try {await work();} finally {await page.unroute('**/pipeline-wizard-config');}
  }
  async function assertNoSecret() {
    const exposed = await page.evaluate(() => ({text: document.querySelector('#hdb-pipeline-wizard').textContent,
      markup: document.querySelector('#hdb-pipeline-wizard').innerHTML, calls: window.__wizardMockCalls,
      storage: {...localStorage, ...sessionStorage}, url: location.href}));
    assert.ok(!JSON.stringify(exposed).includes(SECRET), 'a session credential escaped into markup, review, adapter arguments, status or storage');
    assert.ok(!consoleMessages.some(message => message.includes(SECRET)), 'a session credential appeared in browser logs');
  }
  async function chooseOperations(operations) {
    await page.locator('input[name=workflow][value=operations]').check();
    for (const operation of ['buildschema', 'checkschema', 'run', 'deleteschema']) {
      const input = page.locator(`input[name=operation][value=${operation}]`);
      if (operations.includes(operation)) await input.check(); else await input.uncheck();
    }
    if (operations.includes('buildschema')) await page.locator('#wizard-confirm-build').check();
    if (operations.includes('deleteschema')) {
      await page.locator('#wizard-delete-text').fill((await page.locator('#wizard-delete-target').textContent()).trim());
      await page.locator('#wizard-confirm-delete').check();
    }
  }
  async function start(scenario = 'success') {
    await page.selectOption('#wizard-scenario', scenario); await page.locator('#wizard-preview').click();
  }
  async function waitResult(status) {
    await page.waitForFunction(expected => window.__wizardMockCalls.some(call => call.method === 'result' && call.result?.status === expected), status);
    return page.evaluate(expected => window.__wizardMockCalls.findLast(call => call.method === 'result' && call.result?.status === expected).result, status);
  }
  async function assertResult(result) {
    assert.equal(result.simulated, true); assert.match(result.pipeline_id, /^SIM-PIPE-\d+$/);
    await page.waitForFunction(ids => ids.every(id => document.querySelector('#wizard-simulated-jobs').textContent.includes(id)), result.jobs.map(job => job.job_id));
    assert.ok((await page.locator('#wizard-pipeline-id').textContent()).includes(result.pipeline_id));
    for (const job of result.jobs) {assert.match(job.job_id, /^SIM-JOB-\d+-\d+$/); assert.equal(job.metrics, null);}
    assert.equal(new Set(result.job_ids).size, result.job_ids.length);
    await assertNoSecret();
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
        assert.match(await page.locator('#wizard-mode-notice').textContent(), /simulation mode/i);
        assert.equal(await page.locator('#pipeline-live-notice').isVisible(), false);
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
        assert.match(await page.locator('#wizard-mode-notice').textContent(), /existing live pipeline/i);
        assert.equal(await page.locator('#pipeline-live-notice').isVisible(), true);
        assert.match(await page.locator('#pipeline-live-notice').textContent(), /live source-build pipeline/i);
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

    await check('all seven databases and both workloads support session credentials and a redacted request review', async () => {
      for (const database of ['ora', 'mssqls', 'db2', 'mysql', 'maria', 'pg', 'vsql']) {
        for (const workload of ['C', 'H']) {
          await open(database, workload);
          await connection();
          await benchmark();
          assert.equal(await page.locator('#wizard-share-result').isChecked(), true);
          const request = await review();
          assert.equal(request.database, database);
          assert.equal(request.workload, workload);
          assert.equal(request.target.mode, 'existing');
          assert.equal(request.target.location, 'remote');
          assert.equal(request.target.credential_mode, 'session');
          assert.equal(request.target.connection_profile, undefined);
          assert.deepEqual(request.operations, ['checkschema', 'run']);
          assert.equal(request.share_result, true);
          assert.equal(request.diset[workload === 'C' ? 'tpch' : 'tpcc'], undefined);
          await assertNoSecret();
        }
      }
    });

    await check('invalid native connection values can be repaired without a connection-profile gate', async () => {
      await open();
      await page.locator('#wizard-next').click();
      await page.locator('[data-wizard-step="1"]').waitFor({state: 'visible'});
      assert.equal(await page.locator('#wizard-profile').isVisible(), false);
      await page.locator('[data-native-field=pg_host]').fill('host;exec forbidden');
      await page.locator('#wizard-next').click();
      assert.equal(await page.locator('[data-wizard-step="1"]').isVisible(), true);
      assert.equal(await page.locator('#wizard-error').isVisible(), true);
      assert.equal(await page.locator('#wizard-error').evaluate(el => document.activeElement === el), true);
      await page.locator('[data-native-field=pg_host]').fill('database.example.test');
      await fillSecrets();
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
      await start(); const result = await waitResult('completed'); await assertResult(result);
      assert.equal(result.sharing.status, 'disabled');
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

    await check('source Single/Profile/Compare and I/O form requests retain their contract without reaching CI', async () => {
      for (const [bench, pipeline, workload, io] of [['c_single', 'single', 'C', false],
        ['c_profile', 'profile', 'C', true], ['c_compare', 'compare', 'C', false], ['h_single', 'single', 'H', false]]) {
        await page.goto(`${base}/pipelines?db=pg`); await page.locator('#wizard-form').waitFor({state: 'visible'});
        await page.locator(`#runform input[name=bench][value=${bench}]`).check();
        await page.locator('#runform select[name=tag_sel]').selectOption('__custom__');
        await page.locator('#runform input[name=ref_custom]').fill('refs/heads/REL_17_STABLE');
        const ioInput = page.locator('#runform input[name=io_intensive]');
        if (io) await ioInput.check(); else await ioInput.uncheck();
        captureSource = true;
        try {await Promise.all([page.waitForURL(url => url.searchParams.get('action') === 'run'), page.locator('#runform button[type=submit]').click()]);}
        finally {captureSource = false;}
        const request = sourceCaptures.at(-1);
        assert.equal(request.db, 'pg'); assert.equal(request.pipeline, pipeline); assert.equal(request.workload, workload);
        assert.equal(request.ref_custom, 'refs/heads/REL_17_STABLE'); assert.equal(request.io_intensive === '1', io);
      }
      assert.equal(sourceCaptures.length, 4);
    });

    await check('configured profiles are optional and disable session-secret fields', async () => {
      await metadataOverride(data => {data.generic.profiles = [{id: 'configured-pg', label: 'Configured PostgreSQL'}];}, async () => {
        await open(); await connection(); await page.locator('input[name=credential_mode][value=profile]').check();
        await page.selectOption('#wizard-profile', 'configured-pg');
        assert.equal(await page.locator('#wizard-form input[type=password]:enabled').count(), 0);
        await benchmark(); const request = await review();
        assert.equal(request.target.credential_mode, 'profile'); assert.equal(request.target.connection_profile, 'configured-pg');
        await assertNoSecret();
      });
    });

    await check('benchmark validation errors can be repaired after navigating Back through Connection', async () => {
      await freshBenchmark(); await page.locator('[data-native-field=pg_duration]').fill('0');
      await page.locator('#wizard-back').click(); await benchmark();
      await page.locator('[data-native-field=pg_duration]').fill('3');
      await chooseOperations([]); await page.locator('#wizard-back').click(); await benchmark();
      await page.locator('input[name=operation][value=run]').check();
      const request = await review(); assert.deepEqual(request.operations, ['run']);
    });

    await check('test-driver selection clears timed-only options and review omits disabled values', async () => {
      await freshBenchmark(); await page.locator('#wizard-advanced summary').click();
      await page.locator('[data-native-field=pg_allwarehouse]').check();
      await page.locator('[data-native-field=pg_timeprofile]').check();
      await page.selectOption('[data-native-field=pg_driver]', 'test');
      for (const name of ['pg_allwarehouse', 'pg_timeprofile', 'pg_duration', 'pg_rampup'])
        assert.equal(await page.locator(`[data-native-field=${name}]`).isDisabled(), true);
      const request = await review();
      for (const name of ['pg_allwarehouse', 'pg_timeprofile', 'pg_duration', 'pg_rampup']) assert.equal(request.diset.tpcc[name], undefined);
      await page.locator('#wizard-back').click(); await page.selectOption('[data-native-field=pg_driver]', 'timed');
      assert.equal(await page.locator('[data-native-field=pg_allwarehouse]').isChecked(), false);
      assert.equal(await page.locator('[data-native-field=pg_timeprofile]').isChecked(), false);
    });

    await check('native TLS and Oracle RAC controls retain dependencies and native representations', async () => {
      await open('mysql'); await connection(); await page.locator('#wizard-connection-advanced summary').click();
      await page.locator('[data-native-field=mysql_ssl]').check();
      await page.locator('[data-native-field=mysql_ssl_two_way]').check();
      await page.locator('[data-native-field=mysql_ssl_cert]').fill('/workspace/certs/client.pem');
      await page.locator('[data-native-field=mysql_ssl_key]').fill('/workspace/certs/client-key.pem');
      await benchmark(); let request = await review(); assert.equal(request.diset.connection.mysql_ssl, 'true');
      assert.equal(request.diset.connection.mysql_ssl_key, '/workspace/certs/client-key.pem');
      assert.ok((await page.locator('#wizard-request-json').textContent()).includes('[redacted]'));
      await open('ora'); await connection(); await page.locator('#wizard-connection-advanced summary').click();
      await page.locator('[data-native-field=rac]').check(); await benchmark(); request = await review();
      assert.equal(request.diset.connection.rac, 1); await assertNoSecret();
    });

    await check('SQL Server SQL/Windows/Entra authentication uses native dependencies on both platform descriptors', async () => {
      for (const windows of [false, true]) {
        const exercise = async () => {
          await open('mssqls'); await connection();
          const auth = windows ? 'mssqls_authentication' : 'mssqls_linux_authent';
          await page.selectOption(`[data-native-field=${auth}]`, 'windows');
          assert.equal(await page.locator('[data-native-field=mssqls_uid]').isDisabled(), true);
          assert.equal(await page.locator('[data-native-field=mssqls_pass]').isDisabled(), true);
          await page.selectOption(`[data-native-field=${auth}]`, 'entra');
          await page.locator('#wizard-connection-advanced summary').click();
          await page.locator('[data-native-field=mssqls_msi_object_id]').fill('00000000-0000-0000-0000-000000000001');
          await benchmark(); const request = await review();
          assert.equal(request.diset.connection[auth], 'entra'); assert.equal(request.diset.connection.mssqls_uid, undefined);
          assert.equal(request.diset.connection.mssqls_msi_object_id, '00000000-0000-0000-0000-000000000001');
          await assertNoSecret();
        };
        if (!windows) await exercise();
        else await metadataOverride(data => {
          const names = {mssqls_linux_server: 'mssqls_server', mssqls_linux_authent: 'mssqls_authentication', mssqls_linux_odbc: 'mssqls_odbc_driver'};
          for (const config of Object.values(data.databases.find(db => db.id === 'mssqls').workloads)) for (const field of config.connection) {
            field.name = names[field.name] || field.name;
            for (const condition of [...(field.conditions || []), ...(field.condition ? [field.condition] : [])]) condition.name = names[condition.name] || condition.name;
          }
        }, exercise);
      }
    });

    await check('profile concurrency, schema builders and driver users stay distinct and invalid profiles are repairable', async () => {
      await freshBenchmark(); await page.locator('#wizard-build-schema').check();
      await page.locator('[data-native-field=pg_count_ware]').fill('2');
      await page.locator('[data-native-field=pg_num_vu]').fill('2'); await page.locator('#wizard-driver-vu').fill('4');
      await page.locator('input[name=avu_mode][value=manual]').check(); await page.locator('#wizard-max-avu').fill('16');
      await page.selectOption('#wizard-run-mode', 'profile'); await page.locator('#wizard-profile-points').fill('1 4 2');
      await page.locator('#wizard-confirm-build').check(); await page.locator('#wizard-next').click();
      assert.equal(await page.locator('[data-wizard-step="2"]').isVisible(), true);
      await page.locator('#wizard-profile-points').fill('1 2 4 8'); await page.locator('#wizard-confirm-build').check();
      const request = await review(); assert.equal(request.max_avu.maximum, 16); assert.equal(request.vuset.vu, 4);
      assert.equal(request.diset.tpcc.pg_num_vu, 2); assert.deepEqual(request.profile.concurrency, [1, 2, 4, 8]);
    });

    await check('successful simulation shows exact identities, clears credentials and emits no measured scores', async () => {
      await freshBenchmark(); await review(); await start(); const result = await waitResult('completed'); await assertResult(result);
      assert.equal(result.benchmark_status, 'completed'); assert.equal(result.sharing.status, 'prepared');
      assert.deepEqual(result.jobs.map(job => job.operation), ['checkschema', 'run']);
      assert.equal(await page.locator('#wizard-download').isVisible(), true);
      assert.ok((await page.locator('#wizard-form input[type=password]').evaluateAll(inputs => inputs.map(input => input.value))).every(value => value === ''));
      await screenshot('wizard-simulation-desktop.png');
      await page.locator('#wizard-preview').click();
      await page.waitForFunction(() => window.__wizardMockCalls.filter(call => call.method === 'result').length === 2);
      const repeated = await page.evaluate(() => window.__wizardMockCalls.filter(call => call.method === 'result').map(call => call.result.pipeline_id));
      assert.equal(repeated.length, 2); assert.notEqual(repeated[0], repeated[1]);
      for (const id of repeated) assert.match(id, /^SIM-PIPE-/);
      await assertNoSecret();
    });

    await check('rejection, operation failure, partial profiles and later cleanup/sharing failures stay distinct', async () => {
      for (const scenario of ['rejection', 'failure', 'partial', 'cleanup_failure', 'sharing_failure']) {
        await freshBenchmark();
        if (scenario === 'partial') {await page.selectOption('#wizard-run-mode', 'profile'); await page.locator('#wizard-profile-points').fill('1 2 4');}
        if (scenario === 'cleanup_failure') await chooseOperations(['checkschema', 'run', 'deleteschema']);
        await review(); await start(scenario);
        if (scenario === 'rejection') {
          await page.waitForFunction(() => document.querySelector('#wizard-status').dataset.status === 'rejected');
          assert.equal(await page.locator('#wizard-download').isVisible(), false);
          await start('success'); const accepted = await waitResult('completed'); await assertResult(accepted);
        } else {
          const result = await waitResult(scenario === 'sharing_failure' ? 'completed' : scenario === 'partial' ? 'partial' : 'failed'); await assertResult(result);
          if (scenario === 'partial') {
            const runJobs = result.jobs.filter(job => job.operation === 'run'); assert.equal(runJobs.length, 3);
            assert.ok(runJobs.some(job => job.status === 'completed')); assert.ok(runJobs.some(job => job.status === 'failed'));
            assert.equal(result.benchmark_status, 'partial');
          }
          if (['cleanup_failure', 'sharing_failure'].includes(scenario)) assert.equal(result.benchmark_status, 'completed');
          if (scenario === 'sharing_failure') assert.equal(result.sharing.status, 'failed');
        }
        await assertNoSecret();
      }
    });

    await check('status timeout resumes the same Pipeline without a second submit', async () => {
      await freshBenchmark(); await review(); await start('timeout'); await page.locator('#wizard-retry-status').waitFor({state: 'visible'});
      const ids = await page.evaluate(() => window.__wizardMockCalls.filter(call => call.method === 'submit').map(call => call.result.pipeline_id));
      assert.equal(ids.length, 1); assert.match(ids[0], /^SIM-PIPE-/); await page.locator('#wizard-retry-status').click();
      const result = await waitResult('completed'); await assertResult(result); assert.equal(result.pipeline_id, ids[0]);
      assert.equal(await page.evaluate(() => window.__wizardMockCalls.filter(call => call.method === 'submit').length), 1);
    });

    await check('cancel preserves completed Jobs, restart needs no retained password, and duplicate clicks are locked', async () => {
      await freshBenchmark(); await review(); await page.locator('#wizard-preview').dblclick();
      await page.waitForFunction(() => window.__wizardMockCalls.some(call => call.method === 'status' && call.result?.operations.some(operation => operation.operation === 'checkschema' && operation.status === 'completed')));
      await page.locator('#wizard-cancel').click(); const result = await waitResult('cancelled'); await assertResult(result);
      assert.ok(result.jobs.some(job => job.operation === 'checkschema' && job.status === 'completed'));
      assert.equal(await page.evaluate(() => window.__wizardMockCalls.filter(call => call.method === 'submit').length), 1);
      await page.locator('#wizard-preview').click();
      await page.waitForFunction(previous => window.__wizardMockCalls.some(call => call.method === 'result' && call.result?.pipeline_id !== previous), result.pipeline_id);
      await assertNoSecret();
    });

    await check('responses for a different Pipeline are rejected before rendering and recovery keeps the accepted identity', async () => {
      await freshBenchmark(); await review();
      await page.evaluate(() => {
        const create = window.HammerDBWizardMock.createAdapter;
        window.HammerDBWizardMock.createAdapter = options => {
          const adapter = create(options);
          let first = true;
          return {...adapter, async status(id) {
            const snapshot = await adapter.status(id);
            if (first) {first = false; return {...snapshot, pipeline_id: 'SIM-FOREIGN-PIPELINE'};}
            return snapshot;
          }};
        };
      });
      await start();
      await page.locator('#wizard-retry-status').waitFor({state: 'visible'});
      assert.ok(!(await page.locator('#wizard-progress').textContent()).includes('SIM-FOREIGN-PIPELINE'));
      const accepted = await page.evaluate(() => window.__wizardMockCalls.find(call => call.method === 'submit').result.pipeline_id);
      await page.locator('#wizard-retry-status').click();
      const result = await waitResult('completed'); await assertResult(result);
      assert.equal(result.pipeline_id, accepted);
      assert.equal(await page.evaluate(() => window.__wizardMockCalls.filter(call => call.method === 'submit').length), 1);
    });

    await check('profile Jobs retain exact concurrency identities and sharing disabled never prepares a contribution', async () => {
      await freshBenchmark(); await page.selectOption('#wizard-run-mode', 'profile');
      await page.locator('#wizard-profile-points').fill('1 2 4'); await page.locator('#wizard-share-result').uncheck();
      const request = await review(); assert.equal(request.share_result, false); await start();
      const result = await waitResult('completed'); await assertResult(result);
      assert.deepEqual(result.jobs.filter(job => job.operation === 'run').map(job => job.concurrency), [1, 2, 4]);
      assert.equal(result.sharing.status, 'disabled'); assert.match(await page.locator('#wizard-sharing-status').textContent(), /disabled/i);
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
        assert.match(await page.locator('#wizard-library-status').textContent(), /unavailable.*(preview|simulation)/i);
      } finally {await page.unroute('**/pipeline-wizard-config');}
    });

    await check('main-script failure, metadata failure and disabled JavaScript retain the source workflow', async () => {
      await page.route('**/pipeline-wizard-config', route => route.fulfill({status: 503, body: 'Unavailable'}));
      try {
        await page.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
        await page.getByText('Wizard configuration is unavailable. The existing Pipeline controls remain available below.', {exact: true})
          .waitFor({state: 'visible'});
        assert.equal(await page.locator('#wizard-form').isVisible(), false);
        assert.equal(await page.locator('#existing-pipeline').isVisible(), true);
        assert.equal(await page.locator('#runform button[type=submit]').isDisabled(), false);
      } finally {await page.unroute('**/pipeline-wizard-config');}

      await page.route('**/pipeline-wizard.js', route => route.abort());
      try {
        await page.goto(`${base}/pipelines`, {waitUntil: 'domcontentloaded'});
        assert.equal(await page.locator('#wizard-form').isVisible(), false);
        assert.equal(await page.locator('#existing-pipeline').isVisible(), true);
        assert.equal(await page.locator('#runform button[type=submit]').isDisabled(), false);
      } finally {await page.unroute('**/pipeline-wizard.js');}

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
      await assertNoSecret();
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
    console.log(`PASS: ${checks} browser checks; source requests intercepted; simulations only; no database or GitHub writes`);
  } catch (error) {
    await page.screenshot({path: path.join(artifacts, 'wizard-browser-failure.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally {await browser.close();}
}

main().catch(error => {console.error(error); process.exitCode = 1;});
