/* Remote benchmark target configuration preview; no live remote execution. */
(function (global) {
  'use strict';
  const order = ['buildschema', 'checkschema', 'run', 'deleteschema'];
  const labels = {buildschema: 'Build Schema', checkschema: 'Check Schema', run: 'Run Benchmark', deleteschema: 'Delete Schema'};
  const secretKey = /password|passwd|(?:^|_)pass(?:$|_)|secret|token|credential|authorization|cookie|ssl_key|private_key/i;
  const identityKey = /(?:^|_)(?:user|username|uid|superuser)(?:$|_)/i;
  const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const credentialMode = state => state.credential_mode || (state.connection_profile ? 'profile' : 'session');
  const database = (state, metadata) => (metadata.databases || []).find(db => db.id === state.database);
  const workload = (state, metadata) => database(state, metadata)?.workloads?.[state.workload];
  const fields = (state, metadata) => {
    const config = workload(state, metadata);
    return config ? [...(config.connection || []), ...(config.settings || [])] : [];
  };
  const fieldValue = (field, state) => Object.prototype.hasOwnProperty.call(state.values || {}, field.name)
    ? state.values[field.name] : field.default;
  function conditionsMatch(conditions, state, metadata) {
    return conditions.every(condition => {
      const controlling = fields(state, metadata).find(item => item.name === condition.name);
      const value = controlling ? fieldValue(controlling, state) : (state.values || {})[condition.name];
      const normal = controlling?.type === 'checkbox' ? ([true, 'true', 1, '1'].includes(value) ? (controlling.true_value ?? 'true') : (controlling.false_value ?? 'false')) : value;
      return (condition.values || []).map(String).includes(String(normal));
    });
  }
  function active(field, state, metadata) {
    if ((field.secret || field.credential_only) && credentialMode(state) !== 'session') return false;
    if (field.operations && !field.operations.some(operation => operations(state).includes(operation))) return false;
    if (field.local_only && state.location === 'remote') return false;
    if (field.role === 'builder_vu' && !operations(state).includes('buildschema')) return false;
    if ((['driver', 'rampup', 'duration', 'querysets'].includes(field.role) ||
        field.role === 'advanced' && field.group !== 'connection') && !operations(state).includes('run')) return false;
    return conditionsMatch([...(field.conditions || []), ...(field.condition ? [field.condition] : [])], state, metadata);
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
    const combined = valueFor('endpoint_database');
    return `${state.database || '?'}: ${combined || valueFor('endpoint') || 'configured endpoint'}${port ? `:${port}` : ''}${socket ? ` (socket ${socket})` : ''}${combined ? ' (catalogued database)' : ` / ${valueFor('database') || 'configured schema'}`} [${credentialMode(state) === 'profile' ? `profile ${state.connection_profile || '?'}` : 'session credentials'}]`;
  }
  function validate(state, metadata, options = {}) {
    const errors = [];
    const scope = options.scope || 'all';
    const includes = part => scope === 'all' || scope === part;
    if (!['all', 'target', 'connection', 'benchmark'].includes(scope)) return ['Unknown validation scope.'];
    if (includes('target')) {
      if (!['local', 'remote'].includes(state.location)) errors.push('Choose This instance or Remote database.');
      if (state.target_mode !== 'existing') errors.push('Use the existing Pipeline controls for source provisioning.');
      if (!database(state, metadata)) errors.push('Choose a database supplied by the installation configuration.');
      if (!workload(state, metadata)) errors.push('This workload is unavailable for the selected database.');
    }
    if (includes('connection')) {
      if (!['session', 'profile'].includes(credentialMode(state))) errors.push('Choose session credentials or a configured connection profile.');
      if (credentialMode(state) === 'profile' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(state.connection_profile || '')) errors.push('Choose a configured connection profile.');
    }
    const selected = operations(state);
    if (includes('benchmark')) {
      if (!['benchmark', 'operations'].includes(state.workflow)) errors.push('Choose Run Benchmark or Individual Operations.');
      if (!Array.isArray(selected) || !selected.length || selected.some((value, index) => !order.includes(value) || selected.indexOf(value) !== index)) {
        errors.push('Choose one or more supported operations without duplicates.');
      } else if (selected.some((value, index) => index > 0 && order.indexOf(value) <= order.indexOf(selected[index - 1]))) {
        errors.push('Operations must follow Build, Check, Run, Delete order.');
      }
      if (selected.includes('buildschema') && state.confirm_build !== true) errors.push('Explicitly authorise schema creation.');
      if (selected.includes('deleteschema') && (state.confirm_delete !== true || state.delete_confirmation !== deletionTarget(state, metadata))) {
        errors.push('Authorise deletion and type the exact connection target and schema/database shown.');
      }
    }
    const allowedFields = fields(state, metadata);
    const knownNames = new Set((metadata.databases || []).flatMap(db => Object.values(db.workloads || {})
      .flatMap(config => [...(config.connection || []), ...(config.settings || [])].map(field => field.name))));
    if (scope === 'all') for (const name of Object.keys(state.values || {})) {
      if (!knownNames.has(name)) errors.push('An unsupported setting was supplied.');
    }
    if (includes('benchmark') && selected.includes('buildschema') && state.workload === 'C') {
      const builders = allowedFields.find(field => field.role === 'builder_vu');
      const warehouses = allowedFields.find(field => field.role === 'scale');
      if (builders && warehouses && Number(fieldValue(builders, state)) > Number(fieldValue(warehouses, state))) {
        errors.push('Schema-building virtual users must not exceed the warehouse count.');
      }
    }
    for (const field of allowedFields) {
      if (!active(field, state, metadata)) continue;
      const connectionField = workload(state, metadata)?.connection?.some(item => item.name === field.name);
      if (!includes(connectionField ? 'connection' : 'benchmark')) continue;
      const value = fieldValue(field, state);
      if (field.required && !(field.sensitive_path && credentialMode(state) === 'profile') && (value === undefined || value === null || String(value).trim() === '')) errors.push(`${field.label || field.name} is required.`);
      if (value === undefined || value === null || value === '') continue;
      if (field.secret) {
        if (typeof value !== 'string' || value.length > 4096) errors.push(`${field.label || 'Password'} is too long.`);
        continue;
      }
      if (field.type === 'number' && (!integer(value) || Number(value) < (field.min ?? (field.role === 'rampup' ? 0 : 1)) || (field.max != null && Number(value) > field.max))) errors.push(`${field.label || field.name} must be a supported whole number.`);
      if (field.role === 'port' && (!integer(value) || Number(value) < 1 || Number(value) > 65535)) errors.push('Port must be between 1 and 65535.');
      if (field.type === 'select' && !(field.options || []).map(option => String(typeof option === 'object' ? option.value : option)).includes(String(value))) errors.push(`${field.label || field.name} has an unsupported choice.`);
      if (field.type === 'checkbox' && ![true, false, 'true', 'false', '0', '1', 0, 1].includes(value)) errors.push(`${field.label || field.name} must be enabled or disabled.`);
      if (typeof value === 'string' && (value.length > 512 || /[\x00-\x1f\x7f$;\[\]`]/.test(value))) errors.push(`${field.label || field.name} contains unsupported characters.`);
      if (field.path_reference && typeof value === 'string' && /-----|BEGIN\s+[A-Z ]*(?:KEY|CERTIFICATE)|(?:password|pwd)\s*=|:\/\/[^/]*@/i.test(value)) errors.push(`${field.label || field.name} must be a file reference, never certificate or key contents.`);
      const oracleDescriptor = state.database === 'ora' && field.role === 'endpoint' && /^\s*\((?:DESCRIPTION|DESCRIPTION_LIST)\s*=/i.test(String(value));
      if (['endpoint', 'endpoint_database', 'database', 'username', 'admin_username', 'admin_database'].includes(field.role) && typeof value === 'string' && !(oracleDescriptor ? /^[A-Za-z0-9_.:/(),= \\-]*$/ : /^[A-Za-z0-9_.:/()\\@ -]*$/).test(value)) errors.push(`${field.label || field.name} contains unsupported characters.`);
      if (['endpoint', 'endpoint_database'].includes(field.role) && typeof value === 'string' && (/@/.test(value) || !oracleDescriptor && /\s/.test(value) || /^[a-z]+:\/\//i.test(value) && !value.startsWith('//'))) errors.push('Use an endpoint or native service name without URL credentials or a URI scheme.');
    }
    if (includes('benchmark') && selected.includes('run')) {
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
    if (includes('benchmark') && typeof state.share_result !== 'boolean') errors.push('Choose whether to share the result.');
    return [...new Set(errors)];
  }
  function buildRequest(state, metadata) {
    const errors = validate(state, metadata);
    if (errors.length) throw new Error(errors.join(' '));
    const selected = operations(state);
    const request = {
      api_version: '1', pipeline: 'custom', database: state.database, workload: state.workload,
      target: {mode: 'existing', location: state.location, credential_mode: credentialMode(state)},
      operations: [...selected], diset: {}, share_result: selected.includes('run') && state.share_result
    };
    if (credentialMode(state) === 'profile') request.target.connection_profile = state.connection_profile;
    for (const field of fields(state, metadata)) {
      if (!active(field, state, metadata)) {
        if (field.clear_when && conditionsMatch(field.clear_when, state, metadata)) {
          if (!request.diset[field.group]) request.diset[field.group] = {};
          request.diset[field.group][field.name] = field.inactive_value ?? '';
        }
        continue;
      }
      let value = fieldValue(field, state);
      if (value === undefined || value === null || value === '' && !field.path_reference) continue;
      if (field.path_reference && value === '' && credentialMode(state) === 'profile') continue;
      if (field.secret) {
        if (!request.target.secret_references) request.target.secret_references = {};
        request.target.secret_references[`${field.group}.${field.name}`] = `session:${field.group}.${field.name}`;
        continue;
      }
      if (secretKey.test(field.name) && !field.path_reference) continue;
      if (field.type === 'number') value = Number(value);
      if (field.type === 'checkbox') value = [true, 'true', '1', 1].includes(value) ? (field.true_value ?? 'true') : (field.false_value ?? 'false');
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
      if (!Object.prototype.hasOwnProperty.call(control, 'remoteOriginallyDisabled')) control.remoteOriginallyDisabled = control.disabled;
      control.disabled = !visible || control.remoteOriginallyDisabled;
    }
  }

  function mount(root, metadata) {
    const get = id => root.querySelector('#' + id);
    const form = get('remote-form');
    let step = 0;
    // Existing Pipeline links reload the page with these query parameters.
    // Preserve that workflow without exposing a second set of active controls.
    const query = new URLSearchParams(global.location?.search || '');
    const initialSource = query.get('view') === 'source' || ['db', 'pipeline', 'workload', 'action', 'tag_sel', 'ref_custom', 'ref_cust', 'io_intensive'].some(key => query.has(key));
    const state = {location: 'local', target_mode: initialSource ? 'source' : 'existing', database: (metadata.databases || []).find(db => db.id === 'pg')?.id || metadata.databases?.[0]?.id,
      workload: 'C', credential_mode: 'session', connection_profile: '', values: {}, workflow: 'benchmark', operations: ['checkschema', 'run'], build_schema: false,
      confirm_build: false, confirm_delete: false, delete_confirmation: '', driver_vu: metadata.generic?.virtual_users || 1,
      avu_mode: 'auto', max_avu: 1, run_mode: 'single', profile: (metadata.generic?.autopilot_sequence || []).join(' '), share_result: true};
    const addOption = (select, value, text) => {const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);};
    for (const db of metadata.databases || []) addOption(get('remote-database'), db.id, `${db.label}${db.library_status === 'available' ? '' : ' (client unavailable — preview only)'}`);
    get('remote-database').value = state.database;
    root.querySelector(`input[name="target_mode"][value="${state.target_mode}"]`).checked = true;
    get('remote-driver-vu').value = state.driver_vu;
    get('remote-profile-points').value = state.profile;
    const configuredProfiles = metadata.profiles || metadata.generic?.profiles || [];
    for (const profile of configuredProfiles) addOption(get('remote-profile'), typeof profile === 'string' ? profile : profile.id, typeof profile === 'string' ? profile : profile.label || profile.id);
    root.querySelector('input[name="credential_mode"][value="profile"]').disabled = !configuredProfiles.length;
    if (configuredProfiles.length) state.connection_profile = get('remote-profile').value;
    let busy = false;
    let generation = 0;
    let context = null;
    let reviewedRequest = null;
    let downloadURL = null;
    function clearSecrets() {
      for (const db of metadata.databases || []) for (const config of Object.values(db.workloads || {})) {
        for (const field of [...(config.connection || []), ...(config.settings || [])]) if (field.secret) delete state.values[field.name];
      }
      for (const input of root.querySelectorAll('input[type="password"]')) input.value = '';
    }
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
      get('remote-confirm-build').checked = false; get('remote-confirm-delete').checked = false; get('remote-delete-text').value = '';
    }
    function renderField(field, destination) {
      const label = document.createElement('label'); label.dataset.fieldContainer = field.name;
      const caption = document.createElement('span'); caption.textContent = `${field.label || field.name} (${field.name})`;
      label.append(caption);
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      input.dataset.nativeField = field.name; input.id = 'remote-native-' + field.name;
      input.autocomplete = 'off'; input.spellcheck = false; input.required = Boolean(field.required);
      if (field.type === 'select') {
        for (const option of field.options || []) addOption(input, typeof option === 'object' ? option.value : option, typeof option === 'object' ? option.label : option);
      } else {
        input.type = field.secret || field.type === 'password' ? 'password' : field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : 'text';
        if (input.type === 'password') input.autocomplete = 'new-password';
        if (input.type === 'number') {input.min = field.min ?? (field.role === 'rampup' ? 0 : 1); input.step = '1'; if (field.max != null) input.max = field.max;}
      }
      const value = fieldValue(field, state);
      if (input.type === 'checkbox') input.checked = [true, 'true', 1, '1'].includes(value); else input.value = value ?? '';
      input.addEventListener('input', () => {
        state.values[field.name] = input.type === 'checkbox' ? input.checked : input.value;
        if (field.role === 'driver' && input.value === 'test') {
          // Native option pages clear timed-only flags for the test driver.
          for (const dependent of fields(state, metadata)) {
            const conditions = [...(dependent.conditions || []), ...(dependent.condition ? [dependent.condition] : [])];
            if (dependent.type === 'checkbox' && conditions.some(condition => condition.name === field.name && condition.values?.includes('timed'))) {
              state.values[dependent.name] = false;
              const control = get('remote-native-' + dependent.name);
              if (control) control.checked = false;
            }
          }
        }
        resetConfirmations();
        if (!field.secret && (workload(state, metadata)?.connection || []).some(item => item.name === field.name)) clearSecrets();
        updateFieldDependencies(); updateControls();
      });
      label.append(input); destination.append(label);
    }
    function renderNativeFields() {
      for (const id of ['remote-connection-fields', 'remote-connection-advanced-fields', 'remote-essential-fields', 'remote-advanced-fields']) get(id).replaceChildren();
      const config = workload(state, metadata);
      if (!config) return;
      for (const field of config.connection || []) renderField(field, get(field.advanced ? 'remote-connection-advanced-fields' : 'remote-connection-fields'));
      for (const field of config.settings || []) renderField(field, get(field.advanced ? 'remote-advanced-fields' : 'remote-essential-fields'));
      updateFieldDependencies();
    }
    function selectDatabase() {
      const select = get('remote-workload'); select.replaceChildren();
      for (const key of Object.keys(database(state, metadata)?.workloads || {})) addOption(select, key, key === 'C' ? 'TPROC-C — transactional / OLTP' : 'TPROC-H — analytic');
      if (!workload(state, metadata)) state.workload = select.options[0]?.value;
      select.value = state.workload;
      state.values = {}; resetConfirmations(); renderNativeFields(); updateControls();
    }
    function updateControls() {
      const source = state.location === 'local' && state.target_mode === 'source';
      showSourcePipeline(source);
      get('remote-mode-notice').innerHTML = source
        ? '<strong>Existing live Pipeline</strong> — Run Benchmark below invokes the configured source-build CI. It can provision a database and execute benchmark or schema operations.'
        : '<strong>Simulation mode</strong> — try the existing-database workflow with simulated responses. No database is contacted, no benchmark or schema operation runs, and no GitHub contribution is made.';
      get('remote-local-mode').hidden = state.location === 'remote';
      get('remote-source-help').hidden = !source;
      get('remote-endpoint-choice').hidden = source;
      get('remote-database').disabled = source;
      get('remote-workload').disabled = source;
      get('remote-library-status').hidden = source;
      get('remote-location-help').textContent = state.location === 'remote'
        ? 'Remote database configuration is a preview. The database runs outside this HammerDB instance. Location is relative to HammerDB, not your browser.'
        : 'The database runs on the same server as HammerDB. The existing source-build Pipeline remains available for live execution.';
      const db = database(state, metadata);
      get('remote-library-status').textContent = db?.library_status === 'available'
        ? `${db.label} client adapter loaded. This workflow uses simulated execution only.`
        : `${db?.label || 'Database'} client unavailable — simulation only. A real run requires a supported client installation.`;
      if (db?.native_driver_status === 'unavailable') get('remote-library-status').textContent += ' The selected native database driver is not installed.';
      get('remote-profile-label').hidden = state.credential_mode !== 'profile';
      get('remote-profile').disabled = state.credential_mode !== 'profile';
      get('remote-credential-help').textContent = state.credential_mode === 'session'
        ? 'Passwords stay in this page’s memory and are discarded when the simulation starts or the target changes. Only placeholders reach the simulator; no credentials are checked.'
        : 'The selected profile is a configured reference. Simulation does not retrieve or validate profile credentials.';
      get('remote-simple-operations').hidden = state.workflow !== 'benchmark';
      get('remote-individual-operations').hidden = state.workflow !== 'operations';
      const selected = operations(state);
      get('remote-build-confirmation').hidden = !selected.includes('buildschema');
      get('remote-delete-confirmation').hidden = !selected.includes('deleteschema');
      get('remote-delete-target').textContent = deletionTarget(state, metadata);
      get('remote-run-options').hidden = !selected.includes('run');
      get('remote-share-result').disabled = !selected.includes('run');
      get('remote-manual-avu').hidden = state.avu_mode !== 'manual';
      get('remote-profile-points-label').hidden = state.run_mode !== 'profile';
      const profile = profilePoints(state, metadata);
      const ceiling = profile.length && profile.every(point => Number.isSafeInteger(point) && point > 0) ? Math.max(...profile) : null;
      get('remote-auto-help').textContent = state.workload === 'C'
        ? `Auto uses the configured Autopilot/profile sequence: ${profile.join(', ') || 'not configured'}.${ceiling ? ` Configured ceiling: ${ceiling}; this is not a measured optimum or an admission limit.` : ''} Profile mode measures increasing concurrency points; Single mode remains one run.`
        : 'Auto uses the workload’s query-user settings. A real run must validate effective TPROC-H concurrency limits; TPROC-C throughput profiles are not applied.';
      get('remote-run-mode').querySelector('option[value="profile"]').disabled = state.workload !== 'C';
      if (state.workload !== 'C' && state.run_mode === 'profile') {state.run_mode = 'single'; get('remote-run-mode').value = 'single';}
      get('remote-profile-points-label').hidden = state.run_mode !== 'profile';
      get('remote-next').hidden = source || step === 3;
      get('remote-next').textContent = step === 2 ? 'Review request' : 'Continue';
      get('remote-back').hidden = step === 0;
      get('remote-back').disabled = busy;
      updateFieldDependencies();
    }
    function showStep(next) {
      step = next;
      root.querySelectorAll('[data-remote-step]').forEach((panel, index) => {panel.hidden = index !== step;});
      root.querySelectorAll('.remote-steps li').forEach((item, index) => {if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');});
      get('remote-error').hidden = true;
      updateControls();
      root.querySelector(`[data-remote-step="${step}"] h3`).focus();
    }
    function showErrors(messages) {
      get('remote-error').textContent = messages.join(' ');
      get('remote-error').hidden = false; get('remote-error').focus();
    }
    function renderReview(request) {
      const dl = document.createElement('dl');
      const row = (key, value) => {const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; dl.append(dt, dd);};
      row('Database location', state.location === 'remote' ? 'Remote database' : 'This instance');
      row('Target', `Already-running database — ${deletionTarget(state, metadata)}`);
      row('Credentials', state.credential_mode === 'profile' ? 'Configured profile reference' : 'Session inputs — passwords omitted from this review and simulation');
      row('Database / workload', `${database(state, metadata).label} / TPROC-${state.workload}`);
      row('Operations', request.operations.map(op => labels[op]).join(' → '));
      for (const field of fields(state, metadata).filter(field => active(field, state, metadata) && !secretKey.test(field.name) && !identityKey.test(field.name) &&
        (['scale', 'builder_vu', 'driver', 'rampup', 'duration', 'querysets', 'tls'].includes(field.role) || field.advanced))) row(field.label || field.name, String(fieldValue(field, state)));
      if (request.vuset) {
        row('Benchmark driver virtual users', String(request.vuset.vu));
        row('Run mode', request.run_mode);
        const sequence = profilePoints(state, metadata);
        row('Max AVU', state.avu_mode === 'auto' ? `Auto${state.workload === 'C' && sequence.length ? ` — configured ceiling ${Math.max(...sequence)}` : ''}; no measured optimum assumed` : `Manual: ${state.max_avu}`);
        if (request.profile) row('Profile concurrency points', request.profile.concurrency.join(', '));
      }
      row('Share result to HammerDB leaderboard', !request.operations.includes('run') ? 'Not applicable — no benchmark selected' : request.share_result ? 'Enabled — contribution preparation will be simulated' : 'Disabled');
      row('Execution', 'Simulation only — no real benchmark or schema operation');
      reviewedRequest = JSON.parse(JSON.stringify(request));
      get('remote-review').replaceChildren(dl);
      get('remote-request-json').textContent = JSON.stringify(reviewRequest(request), null, 2);
      get('remote-status').textContent = '';
      get('remote-progress').hidden = true;
      get('remote-preview').textContent = 'Start simulated run';
    }
    const adapters = new Map();
    const terminal = new Set(['completed', 'failed', 'partial', 'cancelled']);
    let requestSerial = 0;
    function setBusy(value) {
      busy = value;
      get('remote-preview').disabled = value;
      get('remote-scenario').disabled = value;
      get('remote-back').disabled = value;
      get('remote-cancel').hidden = !value || !context?.pipeline_id;
      get('remote-cancel').disabled = false;
      if (!value) get('remote-retry-status').hidden = true;
    }
    function setStatus(message, status) {
      get('remote-status').textContent = message;
      get('remote-status').dataset.status = status;
      get('remote-progress').dataset.status = status;
    }
    function renderSnapshot(snapshot) {
      if (snapshot?.simulated !== true || !/^SIM-/.test(snapshot.pipeline_id || '')) throw new Error('Unlabelled simulation response');
      if (context?.pipeline_id && snapshot.pipeline_id !== context.pipeline_id) throw new Error('Simulation response belongs to a different Pipeline');
      if (snapshot.jobs?.some(job => job.simulated !== true || !(snapshot.job_ids || []).includes(job.job_id) ||
          job.pipeline_id && job.pipeline_id !== snapshot.pipeline_id)) throw new Error('Simulation result contains an unrelated Job');
      if (context) context.snapshot = snapshot;
      get('remote-progress').hidden = false;
      get('remote-progress').dataset.status = snapshot.status;
      get('remote-pipeline-id').textContent = `Simulated Pipeline ${snapshot.pipeline_id} — ${snapshot.status}`;
      get('remote-operation-progress').replaceChildren();
      for (const operation of snapshot.operations || []) {
        const item = document.createElement('li'); item.dataset.operation = operation.operation; item.dataset.status = operation.status;
        item.textContent = `${labels[operation.operation] || operation.operation}: ${operation.status}${operation.job_ids?.length ? ` — simulated Jobs ${operation.job_ids.join(', ')}` : ''}`;
        get('remote-operation-progress').append(item);
      }
      const sharing = snapshot.sharing;
      get('remote-sharing-status').textContent = `Simulated sharing: ${sharing?.status || 'not applicable'}. ${sharing?.message || 'No contribution was made.'}`;
      get('remote-sharing-status').dataset.status = sharing?.status || 'not_applicable';
      if (snapshot.jobs) {
        get('remote-simulated-jobs').replaceChildren();
        for (const job of snapshot.jobs) {
          const details = document.createElement('details'); details.dataset.simulatedJob = job.job_id;
          const title = document.createElement('summary'); title.textContent = `Simulated Job ${job.job_id} — ${labels[job.operation] || job.operation}: ${job.status}`;
          const note = document.createElement('p'); note.textContent = 'Simulation fixture only. No database operation ran and no performance was measured.';
          const pre = document.createElement('pre'); pre.textContent = JSON.stringify(reviewRequest(job), null, 2);
          details.append(title, note, pre); get('remote-simulated-jobs').append(details);
        }
        if (downloadURL) URL.revokeObjectURL(downloadURL);
        downloadURL = URL.createObjectURL(new Blob([JSON.stringify(reviewRequest(snapshot), null, 2)], {type: 'application/json'}));
        get('remote-download').href = downloadURL; get('remote-download').hidden = false;
      }
    }
    async function completeSimulation(ctx, snapshot) {
      const token = ctx.token;
      const result = await ctx.adapter.result(ctx.pipeline_id);
      if (token !== generation) return;
      renderSnapshot(result);
      setBusy(false);
      get('remote-preview').textContent = 'Start another simulated run';
      if (result.benchmark_status === 'completed' && snapshot.status === 'failed') {
        setStatus('Simulated benchmark completed; a later cleanup operation failed. The successful simulated Jobs remain available below.', snapshot.status);
      } else if (result.benchmark_status === 'completed' && result.sharing?.status === 'failed') {
        setStatus('Simulated benchmark completed. Simulated sharing failed separately; the successful Jobs remain available below.', snapshot.status);
      } else {
        setStatus(`Simulated run ${snapshot.status}. ${result.benchmark_status === 'partial' ? 'Partial simulated Jobs remain available; this is not a complete successful result.' : 'No real benchmark or schema operation was executed.'}`, snapshot.status);
      }
    }
    async function pollSimulation(ctx) {
      if (ctx.polling) return;
      const token = ctx.token;
      ctx.polling = true;
      get('remote-retry-status').hidden = true;
      try {while (token === generation && busy) {
        try {
          const snapshot = await ctx.adapter.status(ctx.pipeline_id);
          if (token !== generation) return;
          renderSnapshot(snapshot);
          setStatus(`Simulated run ${snapshot.status}. No database operation is being executed.`, snapshot.status);
          if (terminal.has(snapshot.status)) {await completeSimulation(ctx, snapshot); return;}
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          if (token !== generation) return;
          setStatus(error?.code === 'SIMULATED_TIMEOUT'
            ? 'Simulated status timeout. Retry status for this same Pipeline or cancel; no duplicate run is submitted.'
            : 'The simulated response is unavailable. Retry status for this same Pipeline or cancel.', 'timeout');
          get('remote-retry-status').hidden = false;
          return;
        }
      }} finally {ctx.polling = false;}
    }
    form.addEventListener('submit', event => event.preventDefault());
    const markEdited = event => {root.dataset.dirty = 'true'; if (event.target.id !== 'remote-scenario') reviewedRequest = null;};
    form.addEventListener('input', markEdited);
    form.addEventListener('change', markEdited);
    for (const radio of root.querySelectorAll('input[name="location"]')) radio.addEventListener('change', () => {
      state.location = radio.value;
      if (state.location === 'remote') {state.target_mode = 'existing'; root.querySelector('input[name="target_mode"][value="existing"]').checked = true;}
      clearSecrets(); resetConfirmations(); updateControls();
    });
    for (const radio of root.querySelectorAll('input[name="target_mode"]')) radio.addEventListener('change', () => {
      state.target_mode = radio.value; clearSecrets(); resetConfirmations(); updateControls();
    });
    get('remote-existing-link').addEventListener('click', () => {const existing = document.getElementById('existing-pipeline'); if (existing) existing.open = true;});
    get('remote-database').addEventListener('change', event => {state.database = event.target.value; selectDatabase();});
    get('remote-workload').addEventListener('change', event => {state.workload = event.target.value; state.values = {}; resetConfirmations(); renderNativeFields(); updateControls();});
    get('remote-profile').addEventListener('change', event => {state.connection_profile = event.target.value; clearSecrets(); resetConfirmations(); updateControls();});
    for (const radio of root.querySelectorAll('input[name="credential_mode"]')) radio.addEventListener('change', () => {state.credential_mode = radio.value; clearSecrets(); resetConfirmations(); updateControls();});
    for (const radio of root.querySelectorAll('input[name="workflow"]')) radio.addEventListener('change', () => {state.workflow = radio.value; resetConfirmations(); updateControls();});
    for (const input of root.querySelectorAll('input[name="operation"]')) input.addEventListener('change', () => {state.operations = [...root.querySelectorAll('input[name="operation"]:checked')].map(item => item.value); resetConfirmations(); updateControls();});
    const bind = (id, key, checkbox = false) => get(id).addEventListener(checkbox ? 'change' : 'input', event => {state[key] = checkbox ? event.target.checked : event.target.value; if (['build_schema', 'driver_vu', 'profile'].includes(key)) resetConfirmations(); updateControls();});
    bind('remote-build-schema', 'build_schema', true);
    bind('remote-confirm-build', 'confirm_build', true); bind('remote-confirm-delete', 'confirm_delete', true); bind('remote-delete-text', 'delete_confirmation');
    bind('remote-driver-vu', 'driver_vu'); bind('remote-profile-points', 'profile'); bind('remote-share-result', 'share_result', true);
    get('remote-run-mode').addEventListener('change', event => {state.run_mode = event.target.value; updateControls();});
    for (const radio of root.querySelectorAll('input[name="avu_mode"]')) radio.addEventListener('change', () => {state.avu_mode = radio.value; updateControls();});
    function updateAVU(value) {
      state.max_avu = value;
      get('remote-max-avu').value = value;
      if (integer(value) && Number(value) >= 1) {
        const configured = (metadata.generic?.autopilot_sequence || []).filter(point => Number.isSafeInteger(point) && point > 0);
        get('remote-avu-slider').max = metadata.generic?.avu_max ?? Math.max(1, ...configured, Number(value));
        get('remote-avu-slider').value = value;
      }
      get('remote-avu-value').value = value;
    }
    get('remote-max-avu').addEventListener('input', event => updateAVU(event.target.value));
    get('remote-avu-slider').addEventListener('input', event => updateAVU(event.target.value));
    updateAVU(state.max_avu);
    if (metadata.generic?.avu_max != null) get('remote-max-avu').max = metadata.generic.avu_max;
    get('remote-back').addEventListener('click', () => {reviewedRequest = null; showStep(step - 1);});
    get('remote-next').addEventListener('click', () => {
      const errors = validate(state, metadata, {scope: ['target', 'connection', 'benchmark'][step]});
      if (errors.length) {showErrors(errors); return;}
      if (step === 2) {
        const connectionErrors = validate(state, metadata, {scope: 'connection'});
        if (connectionErrors.length) {showStep(1); showErrors(connectionErrors); return;}
        const allErrors = validate(state, metadata);
        if (allErrors.length) {showErrors(allErrors); return;}
        renderReview(buildRequest(state, metadata));
      }
      showStep(step + 1);
    });
    get('remote-preview').addEventListener('click', async () => {
      if (busy) return;
      const errors = reviewedRequest ? [] : validate(state, metadata);
      if (errors.length) {showErrors(errors); return;}
      if (!global.HammerDBRemoteBenchmarkPreview) {showErrors(['The simulation is unavailable. No request was submitted.']); return;}
      const request = reviewedRequest ? JSON.parse(JSON.stringify(reviewedRequest)) : buildRequest(state, metadata);
      request.request_id = `remote-simulation-${Date.now()}-${++requestSerial}`;
      reviewedRequest = JSON.parse(JSON.stringify(request));
      clearSecrets();
      context = null;
      const token = ++generation;
      setBusy(true);
      get('remote-progress').hidden = true;
      get('remote-simulated-jobs').replaceChildren();
      get('remote-download').hidden = true;
      get('remote-retry-status').hidden = true;
      setStatus('Submitting to the in-page simulator only…', 'submitting');
      try {
        const scenario = get('remote-scenario').value;
        if (!adapters.has(scenario)) adapters.set(scenario, global.HammerDBRemoteBenchmarkPreview.createAdapter({scenario}));
        const adapter = adapters.get(scenario);
        const accepted = await adapter.submit(request);
        if (token !== generation) return;
        context = {adapter, pipeline_id: accepted.pipeline_id, token};
        renderSnapshot(accepted);
        setBusy(true);
        setStatus(`Simulated request accepted — ${accepted.pipeline_id} queued.`, 'queued');
        await pollSimulation(context);
      } catch (error) {
        if (token !== generation) return;
        setBusy(false);
        get('remote-preview').textContent = 'Try simulated run again';
        setStatus(error?.code === 'SIMULATED_REJECTION'
          ? 'Simulated request rejected. Check the selected test outcome and plan, then try again deliberately. No real request was submitted.'
          : 'The simulated run could not be started. No real request was submitted.', 'rejected');
      }
    });
    get('remote-retry-status').addEventListener('click', () => {if (busy && context) pollSimulation(context);});
    get('remote-cancel').addEventListener('click', async () => {
      if (!busy || !context || get('remote-cancel').disabled) return;
      const ctx = context;
      ctx.token = ++generation;
      get('remote-cancel').disabled = true;
      get('remote-retry-status').hidden = true;
      try {
        const cancelled = await ctx.adapter.cancel(ctx.pipeline_id);
        if (ctx.token !== generation) return;
        await completeSimulation(ctx, cancelled);
      } catch (_) {
        if (ctx.token !== generation) return;
        get('remote-cancel').disabled = false;
        get('remote-retry-status').hidden = false;
        setStatus('The cancellation response is unavailable. Retry status for the same simulated Pipeline.', 'timeout');
      }
    });
    global.addEventListener?.('pagehide', () => {generation += 1; clearSecrets(); if (downloadURL) URL.revokeObjectURL(downloadURL);});
    selectDatabase();
    form.hidden = false; get('remote-loading').hidden = true;
    return {state, metadata, buildRequest: () => buildRequest(state, metadata), get simulation() {return context?.snapshot || null;}};
  }
  const api = {validate, buildRequest, reviewRequest, deletionTarget, mount};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global.document) {
    global.HammerDBRemoteBenchmark = api;
    const start = async () => {
      const root = document.getElementById('hdb-remote-benchmark');
      if (!root) return;
      try {
        const response = await fetch(root.dataset.configUrl, {cache: 'no-store', credentials: 'same-origin'});
        if (!response.ok) throw new Error('Configuration unavailable');
        const metadata = await response.json();
        if (!Array.isArray(metadata.databases) || !metadata.databases.length) throw new Error('No database configuration');
        root.remoteBenchmark = mount(root, metadata);
      } catch (_) {
        root.querySelector('#remote-form').hidden = true;
        showSourcePipeline(true);
        root.querySelector('#remote-loading').textContent = 'Remote benchmark configuration is unavailable. The existing Pipeline controls remain available below.';
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
