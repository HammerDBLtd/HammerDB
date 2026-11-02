/* HammerDB 6.2 Stage 1: presentation and proposed requests only. No execution. */
(function (global) {
  'use strict';
  const order = ['buildschema', 'checkschema', 'run', 'deleteschema'];
  const labels = {buildschema: 'Build Schema', checkschema: 'Check Schema', run: 'Run Benchmark', deleteschema: 'Delete Schema'};
  const secretKey = /password|passwd|(?:^|_)pass(?:$|_)|secret|token|credential|authorization|cookie|ssl_key|private_key/i;
  const identityKey = /(?:^|_)(?:user|username|uid|superuser)(?:$|_)/i;
  const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const database = (state, metadata) => (metadata.databases || []).find(db => db.id === state.database);
  const workload = (state, metadata) => database(state, metadata)?.workloads?.[state.workload];
  const fields = (state, metadata) => {
    const config = workload(state, metadata);
    return config ? [...(config.connection || []), ...(config.settings || [])] : [];
  };
  const fieldValue = (field, state) => Object.prototype.hasOwnProperty.call(state.values || {}, field.name)
    ? state.values[field.name] : field.default;
  function active(field, state, metadata) {
    if (field.local_only && state.location === 'remote') return false;
    if (field.role === 'builder_vu' && !operations(state).includes('buildschema')) return false;
    if ((['driver', 'rampup', 'duration', 'querysets'].includes(field.role) ||
        field.role === 'advanced' && field.group !== 'connection') && !operations(state).includes('run')) return false;
    if (field.condition) {
      const controlling = fields(state, metadata).find(item => item.name === field.condition.name);
      const value = controlling ? fieldValue(controlling, state) : (state.values || {})[field.condition.name];
      if (!(field.condition.values || []).map(String).includes(String(value))) return false;
    }
    return true;
  }
  function operations(state) {
    return state.workflow === 'operations' ? (state.operations || [])
      : (state.build_schema ? ['buildschema', 'checkschema', 'run'] : ['checkschema', 'run']);
  }
  function profilePoints(state, metadata) {
    const input = state.run_mode !== 'profile' || state.profile === undefined
      ? metadata.generic?.autopilot_sequence : state.profile;
    return Array.isArray(input) ? input.map(Number) : String(input || '').trim().split(/[ ,]+/).filter(Boolean).map(Number);
  }
  function deletionTarget(state, metadata) {
    const connection = fields(state, metadata).filter(field => active(field, state, metadata));
    const valueFor = role => connection.filter(field => field.role === role)
      .map(field => String(fieldValue(field, state) ?? '').trim()).filter(Boolean).join(', ');
    const port = valueFor('port');
    const socket = valueFor('socket');
    return `${state.database || '?'}: ${valueFor('endpoint') || 'configured endpoint'}${port ? `:${port}` : ''}${socket ? ` (socket ${socket})` : ''} / ${valueFor('database') || 'configured schema'} [profile ${state.connection_profile || '?'}]`;
  }
  function validate(state, metadata) {
    const errors = [];
    if (!['local', 'remote'].includes(state.location)) errors.push('Choose This instance or Remote database.');
    if (state.target_mode !== 'existing') errors.push('Use the existing Pipeline controls for source provisioning.');
    if (!database(state, metadata)) errors.push('Choose a database supplied by the installation configuration.');
    if (!workload(state, metadata)) errors.push('This workload is unavailable for the selected database.');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(state.connection_profile || '')) errors.push('Enter an operator connection profile reference using letters, numbers, dots, underscores or hyphens.');
    if (!['benchmark', 'operations'].includes(state.workflow)) errors.push('Choose Run Benchmark or Individual Operations.');
    const selected = operations(state);
    if (!Array.isArray(selected) || !selected.length || selected.some((value, index) => !order.includes(value) || selected.indexOf(value) !== index)) {
      errors.push('Choose one or more supported operations without duplicates.');
    } else if (selected.some((value, index) => index > 0 && order.indexOf(value) <= order.indexOf(selected[index - 1]))) {
      errors.push('Operations must follow Build, Check, Run, Delete order.');
    }
    if (selected.includes('buildschema') && state.confirm_build !== true) errors.push('Explicitly authorise schema creation.');
    if (selected.includes('deleteschema') && (state.confirm_delete !== true || state.delete_confirmation !== deletionTarget(state, metadata))) {
      errors.push('Authorise deletion and type the exact connection target and schema/database shown.');
    }
    const allowedFields = fields(state, metadata);
    const knownNames = new Set((metadata.databases || []).flatMap(db => Object.values(db.workloads || {})
      .flatMap(config => [...(config.connection || []), ...(config.settings || [])].map(field => field.name))));
    for (const name of Object.keys(state.values || {})) {
      if (secretKey.test(name) || !knownNames.has(name)) errors.push('An unsupported or credential setting was supplied.');
    }
    if (selected.includes('buildschema') && state.workload === 'C') {
      const builders = allowedFields.find(field => field.role === 'builder_vu');
      const warehouses = allowedFields.find(field => field.role === 'scale');
      if (builders && warehouses && Number(fieldValue(builders, state)) > Number(fieldValue(warehouses, state))) {
        errors.push('Schema-building virtual users must not exceed the warehouse count.');
      }
    }
    for (const field of allowedFields) {
      if (!active(field, state, metadata)) continue;
      const value = fieldValue(field, state);
      if (field.required && (value === undefined || value === null || String(value).trim() === '')) errors.push(`${field.label || field.name} is required.`);
      if (value === undefined || value === null || value === '') continue;
      if (field.type === 'number' && (!integer(value) || Number(value) < (field.min ?? (field.role === 'rampup' ? 0 : 1)) || (field.max != null && Number(value) > field.max))) errors.push(`${field.label || field.name} must be a supported whole number.`);
      if (field.role === 'port' && (!integer(value) || Number(value) < 1 || Number(value) > 65535)) errors.push('Port must be between 1 and 65535.');
      if (field.type === 'select' && !(field.options || []).map(option => String(typeof option === 'object' ? option.value : option)).includes(String(value))) errors.push(`${field.label || field.name} has an unsupported choice.`);
      if (field.type === 'checkbox' && ![true, false, 'true', 'false', '0', '1', 0, 1].includes(value)) errors.push(`${field.label || field.name} must be enabled or disabled.`);
      if (typeof value === 'string' && (value.length > 512 || /[\x00-\x1f\x7f$;\[\]`]/.test(value))) errors.push(`${field.label || field.name} contains unsupported characters.`);
      if (['endpoint', 'database', 'username'].includes(field.role) && typeof value === 'string' && !/^[A-Za-z0-9_.:/()\\@ -]*$/.test(value)) errors.push(`${field.label || field.name} contains unsupported characters.`);
      if (field.role === 'endpoint' && typeof value === 'string' && (/@/.test(value) || /\s/.test(value) || /^[a-z]+:\/\//i.test(value) && !value.startsWith('//'))) errors.push('Use an endpoint or native service name without URL credentials or a URI scheme.');
    }
    if (selected.includes('run')) {
      if (!integer(state.driver_vu) || Number(state.driver_vu) < 1) errors.push('Benchmark driver virtual users must be a positive whole number.');
      if (!['single', 'profile'].includes(state.run_mode)) errors.push('Choose a supported run mode.');
      if (state.run_mode === 'profile' && state.workload !== 'C') errors.push('The current profile preview supports TPROC-C only.');
      if (!['auto', 'manual'].includes(state.avu_mode)) errors.push('Choose Auto or Manual Max AVU.');
      if (state.avu_mode === 'manual' && (!integer(state.max_avu) || Number(state.max_avu) < (metadata.generic?.avu_min ?? 1) || metadata.generic?.avu_max != null && Number(state.max_avu) > metadata.generic.avu_max)) errors.push('Manual Max AVU must be a supported positive whole number.');
      if (state.avu_mode === 'auto' && state.workload === 'C' || state.run_mode === 'profile') {
        const points = profilePoints(state, metadata);
        if (!points.length || points.some((point, index) => !Number.isSafeInteger(point) || point < 1 || index > 0 && point <= points[index - 1])) errors.push('Profile concurrency points must be increasing positive whole numbers.');
        if (state.run_mode === 'profile' && state.avu_mode === 'manual' && points.some(point => point > Number(state.max_avu))) errors.push('Profile concurrency points must not exceed Manual Max AVU.');
      }
    }
    if (typeof state.share_result !== 'boolean') errors.push('Choose whether to share the result.');
    return [...new Set(errors)];
  }
  function buildRequest(state, metadata) {
    const errors = validate(state, metadata);
    if (errors.length) throw new Error(errors.join(' '));
    const selected = operations(state);
    const request = {
      api_version: '1', pipeline: 'custom', database: state.database, workload: state.workload,
      target: {mode: 'existing', location: state.location, connection_profile: state.connection_profile},
      operations: [...selected], diset: {}, share_result: state.share_result
    };
    for (const field of fields(state, metadata)) {
      if (!active(field, state, metadata) || secretKey.test(field.name)) continue;
      let value = fieldValue(field, state);
      if (value === undefined || value === null || value === '') continue;
      if (field.type === 'number') value = Number(value);
      if (field.type === 'checkbox') value = [true, 'true', '1', 1].includes(value) ? 'true' : 'false';
      if (!request.diset[field.group]) request.diset[field.group] = {};
      request.diset[field.group][field.name] = value;
    }
    if (selected.includes('run')) {
      request.run_mode = state.run_mode;
      request.vuset = {vu: Number(state.driver_vu)};
      request.max_avu = {mode: state.avu_mode};
      if (state.avu_mode === 'manual') request.max_avu.maximum = Number(state.max_avu);
      else if (state.workload === 'C') request.max_avu.autopilot_sequence = profilePoints(state, metadata);
      if (state.run_mode === 'profile') request.profile = {concurrency: profilePoints(state, metadata)};
    }
    if (selected.includes('buildschema') || selected.includes('deleteschema')) {
      request.confirmations = {};
      if (selected.includes('buildschema')) request.confirmations.buildschema = {confirmed: true, target: deletionTarget(state, metadata)};
      if (selected.includes('deleteschema')) request.confirmations.deleteschema = {confirmed: true, target: deletionTarget(state, metadata)};
    }
    return request;
  }
  function reviewRequest(request) {
    if (Array.isArray(request)) return request.map(reviewRequest);
    if (request && typeof request === 'object') {
      const safe = {};
      for (const [key, value] of Object.entries(request)) {
        safe[key] = secretKey.test(key) || identityKey.test(key) ? '[redacted]' : reviewRequest(value);
      }
      return safe;
    }
    return request;
  }

  function showSourcePipeline(visible) {
    const existing = document.getElementById('existing-pipeline');
    if (!existing) return;
    existing.hidden = !visible;
    existing.open = visible;
    for (const control of existing.querySelectorAll('input,select,button')) {
      if (!Object.prototype.hasOwnProperty.call(control, 'wizardOriginallyDisabled')) control.wizardOriginallyDisabled = control.disabled;
      control.disabled = !visible || control.wizardOriginallyDisabled;
    }
  }

  function mount(root, metadata) {
    const get = id => root.querySelector('#' + id);
    const form = get('wizard-form');
    let step = 0;
    // Existing Pipeline links reload the page with these query parameters.
    // Preserve that workflow without exposing a second set of active controls.
    const query = new URLSearchParams(global.location?.search || '');
    const initialSource = query.get('view') === 'source' || ['db', 'pipeline', 'workload', 'action', 'tag_sel', 'ref_custom', 'ref_cust', 'io_intensive'].some(key => query.has(key));
    const state = {location: 'local', target_mode: initialSource ? 'source' : 'existing', database: (metadata.databases || []).find(db => db.id === 'pg')?.id || metadata.databases?.[0]?.id,
      workload: 'C', connection_profile: '', values: {}, workflow: 'benchmark', operations: ['checkschema', 'run'], build_schema: false,
      confirm_build: false, confirm_delete: false, delete_confirmation: '', driver_vu: metadata.generic?.virtual_users || 1,
      avu_mode: 'auto', max_avu: 1, run_mode: 'single', profile: (metadata.generic?.autopilot_sequence || []).join(' '), share_result: true};
    const addOption = (select, value, text) => {const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);};
    for (const db of metadata.databases || []) addOption(get('wizard-database'), db.id, `${db.label}${db.library_status === 'available' ? '' : ' (client unavailable — preview only)'}`);
    get('wizard-database').value = state.database;
    root.querySelector(`input[name="target_mode"][value="${state.target_mode}"]`).checked = true;
    get('wizard-driver-vu').value = state.driver_vu;
    get('wizard-profile-points').value = state.profile;
    function updateFieldDependencies() {
      for (const container of root.querySelectorAll('[data-field-container]')) {
        const field = fields(state, metadata).find(item => item.name === container.dataset.fieldContainer);
        const enabled = Boolean(field && active(field, state, metadata));
        container.hidden = !enabled;
        container.querySelector('input,select').disabled = !enabled;
      }
    }
    function resetConfirmations() {
      state.confirm_build = false; state.confirm_delete = false; state.delete_confirmation = '';
      get('wizard-confirm-build').checked = false; get('wizard-confirm-delete').checked = false; get('wizard-delete-text').value = '';
    }
    function renderField(field, destination) {
      const label = document.createElement('label'); label.dataset.fieldContainer = field.name;
      const caption = document.createElement('span'); caption.textContent = `${field.label || field.name} (${field.name})`;
      label.append(caption);
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      input.dataset.nativeField = field.name; input.id = 'wizard-native-' + field.name;
      input.autocomplete = 'off'; input.spellcheck = false; input.required = Boolean(field.required);
      if (field.type === 'select') {
        for (const option of field.options || []) addOption(input, typeof option === 'object' ? option.value : option, typeof option === 'object' ? option.label : option);
      } else {
        input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : 'text';
        if (input.type === 'number') {input.min = field.min ?? (field.role === 'rampup' ? 0 : 1); input.step = '1'; if (field.max != null) input.max = field.max;}
      }
      const value = fieldValue(field, state);
      if (input.type === 'checkbox') input.checked = [true, 'true', 1, '1'].includes(value); else input.value = value ?? '';
      input.addEventListener('input', () => {
        state.values[field.name] = input.type === 'checkbox' ? input.checked : input.value;
        if ((workload(state, metadata)?.connection || []).some(item => item.name === field.name)) resetConfirmations();
        updateFieldDependencies(); updateControls();
      });
      label.append(input); destination.append(label);
    }
    function renderNativeFields() {
      for (const id of ['wizard-connection-fields', 'wizard-essential-fields', 'wizard-advanced-fields']) get(id).replaceChildren();
      const config = workload(state, metadata);
      if (!config) return;
      for (const field of config.connection || []) renderField(field, get('wizard-connection-fields'));
      for (const field of config.settings || []) renderField(field, get(field.advanced ? 'wizard-advanced-fields' : 'wizard-essential-fields'));
      updateFieldDependencies();
    }
    function selectDatabase() {
      const select = get('wizard-workload'); select.replaceChildren();
      for (const key of Object.keys(database(state, metadata)?.workloads || {})) addOption(select, key, key === 'C' ? 'TPROC-C — transactional / OLTP' : 'TPROC-H — analytic');
      if (!workload(state, metadata)) state.workload = select.options[0]?.value;
      select.value = state.workload;
      state.values = {}; resetConfirmations(); renderNativeFields(); updateControls();
    }
    function updateControls() {
      const source = state.location === 'local' && state.target_mode === 'source';
      showSourcePipeline(source);
      get('wizard-local-mode').hidden = state.location === 'remote';
      get('wizard-source-help').hidden = !source;
      get('wizard-endpoint-choice').hidden = source;
      get('wizard-database').disabled = source;
      get('wizard-workload').disabled = source;
      get('wizard-library-status').hidden = source;
      get('wizard-location-help').textContent = state.location === 'remote'
        ? 'The database already runs elsewhere, for example Amazon RDS, Aurora, Azure or an on-premises server. The location is relative to HammerDB, not your browser.'
        : 'The database runs on the same server as HammerDB, for example the HammerDB Cloud EC2 instance.';
      const db = database(state, metadata);
      get('wizard-library-status').textContent = db?.library_status === 'available'
        ? `${db.label} client library loaded. Custom execution and connection validation remain unavailable in this wizard preview.`
        : `${db?.label || 'Database'} client library unavailable. Configuration preview only; execution requires an installed supported client and backend validation.`;
      get('wizard-simple-operations').hidden = state.workflow !== 'benchmark';
      get('wizard-individual-operations').hidden = state.workflow !== 'operations';
      const selected = operations(state);
      get('wizard-build-confirmation').hidden = !selected.includes('buildschema');
      get('wizard-delete-confirmation').hidden = !selected.includes('deleteschema');
      get('wizard-delete-target').textContent = deletionTarget(state, metadata);
      get('wizard-run-options').hidden = !selected.includes('run');
      get('wizard-manual-avu').hidden = state.avu_mode !== 'manual';
      get('wizard-profile-points-label').hidden = state.run_mode !== 'profile';
      const profile = profilePoints(state, metadata);
      get('wizard-auto-help').textContent = state.workload === 'C'
        ? `Auto delegates to the existing Autopilot/profile settings. Configured concurrency sequence: ${profile.join(', ') || 'not configured'}. Effective active-user limits require backend validation; the highest count is not necessarily the fastest.`
        : 'Auto remains a preview preference. TPROC-H query-user concurrency and effective limits require workload-specific backend validation; no TPROC-C throughput profile is assumed.';
      get('wizard-run-mode').querySelector('option[value="profile"]').disabled = state.workload !== 'C';
      if (state.workload !== 'C' && state.run_mode === 'profile') {state.run_mode = 'single'; get('wizard-run-mode').value = 'single';}
      get('wizard-next').hidden = source || step === 3;
      get('wizard-next').textContent = step === 2 ? 'Review request' : 'Continue';
      get('wizard-back').hidden = step === 0;
      updateFieldDependencies();
    }
    function showStep(next) {
      step = next;
      root.querySelectorAll('[data-wizard-step]').forEach((panel, index) => {panel.hidden = index !== step;});
      root.querySelectorAll('.wizard-steps li').forEach((item, index) => {if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');});
      get('wizard-error').hidden = true;
      updateControls();
      root.querySelector(`[data-wizard-step="${step}"] h3`).focus();
    }
    function showErrors(messages) {
      get('wizard-error').textContent = messages.join(' ');
      get('wizard-error').hidden = false; get('wizard-error').focus();
    }
    function renderReview(request) {
      const dl = document.createElement('dl');
      const row = (key, value) => {const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; dl.append(dt, dd);};
      row('Database location', state.location === 'remote' ? 'Remote database' : 'This instance');
      row('Target', `Already-running database — ${deletionTarget(state, metadata)}`);
      row('Database / workload', `${database(state, metadata).label} / TPROC-${state.workload}`);
      row('Operations', request.operations.map(op => labels[op]).join(' → '));
      for (const field of fields(state, metadata).filter(field => active(field, state, metadata) && !secretKey.test(field.name) && !identityKey.test(field.name) &&
        (['scale', 'builder_vu', 'driver', 'rampup', 'duration', 'querysets', 'tls'].includes(field.role) || field.advanced))) row(field.label || field.name, String(fieldValue(field, state)));
      if (request.vuset) {
        row('Benchmark driver virtual users', String(request.vuset.vu));
        row('Run mode', request.run_mode);
        row('Max AVU', state.avu_mode === 'auto' ? 'Auto — effective maximum awaiting backend validation' : `Manual: ${state.max_avu}`);
        if (request.profile) row('Profile concurrency points', request.profile.concurrency.join(', '));
      }
      row('Share result to HammerDB leaderboard', state.share_result ? 'Enabled — preparation awaits authorised backend integration' : 'Disabled');
      row('Execution', 'Preview only — no request submitted, Pipeline or Job created');
      get('wizard-review').replaceChildren(dl);
      get('wizard-request-json').textContent = JSON.stringify(reviewRequest(request), null, 2);
      get('wizard-status').textContent = '';
    }
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('input', () => {root.dataset.dirty = 'true';});
    form.addEventListener('change', () => {root.dataset.dirty = 'true';});
    for (const radio of root.querySelectorAll('input[name="location"]')) radio.addEventListener('change', () => {
      state.location = radio.value;
      if (state.location === 'remote') {state.target_mode = 'existing'; root.querySelector('input[name="target_mode"][value="existing"]').checked = true;}
      resetConfirmations(); updateControls();
    });
    for (const radio of root.querySelectorAll('input[name="target_mode"]')) radio.addEventListener('change', () => {
      state.target_mode = radio.value; updateControls();
    });
    get('wizard-existing-link').addEventListener('click', () => {const existing = document.getElementById('existing-pipeline'); if (existing) existing.open = true;});
    get('wizard-database').addEventListener('change', event => {state.database = event.target.value; selectDatabase();});
    get('wizard-workload').addEventListener('change', event => {state.workload = event.target.value; state.values = {}; resetConfirmations(); renderNativeFields(); updateControls();});
    get('wizard-profile').addEventListener('input', event => {state.connection_profile = event.target.value; resetConfirmations(); updateControls();});
    for (const radio of root.querySelectorAll('input[name="workflow"]')) radio.addEventListener('change', () => {state.workflow = radio.value; resetConfirmations(); updateControls();});
    for (const input of root.querySelectorAll('input[name="operation"]')) input.addEventListener('change', () => {state.operations = [...root.querySelectorAll('input[name="operation"]:checked')].map(item => item.value); resetConfirmations(); updateControls();});
    const bind = (id, key, checkbox = false) => get(id).addEventListener(checkbox ? 'change' : 'input', event => {state[key] = checkbox ? event.target.checked : event.target.value; updateControls();});
    bind('wizard-build-schema', 'build_schema', true);
    bind('wizard-confirm-build', 'confirm_build', true); bind('wizard-confirm-delete', 'confirm_delete', true); bind('wizard-delete-text', 'delete_confirmation');
    bind('wizard-driver-vu', 'driver_vu'); bind('wizard-profile-points', 'profile'); bind('wizard-share-result', 'share_result', true);
    get('wizard-run-mode').addEventListener('change', event => {state.run_mode = event.target.value; updateControls();});
    for (const radio of root.querySelectorAll('input[name="avu_mode"]')) radio.addEventListener('change', () => {state.avu_mode = radio.value; updateControls();});
    function updateAVU(value) {
      state.max_avu = value;
      get('wizard-max-avu').value = value;
      if (integer(value) && Number(value) >= 1) {
        get('wizard-avu-slider').max = metadata.generic?.avu_max ?? Math.max(24, Number(value));
        get('wizard-avu-slider').value = value;
      }
      get('wizard-avu-value').value = value;
    }
    get('wizard-max-avu').addEventListener('input', event => updateAVU(event.target.value));
    get('wizard-avu-slider').addEventListener('input', event => updateAVU(event.target.value));
    if (metadata.generic?.avu_max != null) {get('wizard-avu-slider').max = metadata.generic.avu_max; get('wizard-max-avu').max = metadata.generic.avu_max;}
    get('wizard-back').addEventListener('click', () => showStep(step - 1));
    get('wizard-next').addEventListener('click', () => {
      if (step === 0 && !workload(state, metadata)) {showErrors(['Choose a supported database and workload.']); return;}
      if (step === 1) {
        const connectionErrors = validate(state, metadata).filter(error => !/virtual users|Max AVU|Profile concurrency|authorise schema|Authorise deletion/i.test(error));
        if (connectionErrors.length) {showErrors(connectionErrors); return;}
      }
      if (step === 2) {
        const errors = validate(state, metadata);
        if (errors.length) {showErrors(errors); return;}
        renderReview(buildRequest(state, metadata));
      }
      showStep(step + 1);
    });
    get('wizard-preview').addEventListener('click', () => {
      const errors = validate(state, metadata);
      if (errors.length) {showErrors(errors); return;}
      get('wizard-status').textContent = 'Preview complete. Nothing was submitted. The enhanced authenticated /cihook backend, exact Pipeline/Job association and authorised result-sharing integration are required before execution.';
      get('wizard-status').focus();
    });
    selectDatabase();
    form.hidden = false; get('wizard-loading').hidden = true;
    return {state, metadata, buildRequest: () => buildRequest(state, metadata)};
  }
  const api = {validate, buildRequest, reviewRequest, deletionTarget, mount};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global.document) {
    global.HammerDBWizard = api;
    const start = async () => {
      const root = document.getElementById('hdb-pipeline-wizard');
      if (!root) return;
      try {
        const response = await fetch(root.dataset.configUrl, {cache: 'no-store', credentials: 'same-origin'});
        if (!response.ok) throw new Error('Configuration unavailable');
        const metadata = await response.json();
        if (!Array.isArray(metadata.databases) || !metadata.databases.length) throw new Error('No database configuration');
        root.wizard = mount(root, metadata);
      } catch (_) {
        root.querySelector('#wizard-form').hidden = true;
        showSourcePipeline(true);
        root.querySelector('#wizard-loading').textContent = 'Wizard configuration is unavailable. The existing Pipeline controls remain available below.';
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
