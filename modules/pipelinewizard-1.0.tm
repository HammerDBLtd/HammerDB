# Stage 1 presentation only. The enhanced CI execution contract is not live.
package provide pipelinewizard 1.0
namespace eval pipelinewizard {
    namespace export wapp-page-pipeline-wizard.js wapp-page-pipeline-wizard.css wapp-page-pipeline-wizard-config
    variable assetdir [file join [file dirname [info script]] .. src webservice]

    proc asset {name mimetype} {
        variable assetdir
        wapp-mimetype $mimetype
        set channel [open [file join $assetdir $name] r]
        try {wapp-unsafe [read $channel]} finally {close $channel}
    }
    proc wapp-page-pipeline-wizard.js {} {
        asset pipelinewizard.js {text/javascript; charset=utf-8}
    }
    proc wapp-page-pipeline-wizard.css {} {
        asset pipelinewizard.css {text/css; charset=utf-8}
    }
    proc wapp-page-pipeline-wizard-config {} {
        package require wizardconfig 1.0
        wapp-mimetype {application/json; charset=utf-8}
        wapp-reply-extra Cache-Control no-store
        wapp-unsafe [wizardconfig::metadata]
    }
    proc render {B} {
        wapp-subst {
<link rel="stylesheet" href="%url($B/pipeline-wizard.css)">
<section id="hdb-pipeline-wizard" data-pipeline-wizard aria-labelledby="wizard-title" data-config-url="%html($B/pipeline-wizard-config)">
  <h2 id="wizard-title">Configure a benchmark</h2>
  <p class="wizard-notice"><strong>Wizard preview</strong> — review an existing-endpoint request. Custom CI execution, connection checks and result sharing are awaiting backend integration. Nothing is submitted by this wizard.</p>
  <p id="wizard-loading" role="status">Loading installation configuration…</p>
  <noscript><style>html #existing-pipeline[hidden]{display:block!important}</style><p>Enable JavaScript to use the wizard. The existing source-build Pipeline remains available below.</p></noscript>
  <form id="wizard-form" hidden novalidate>
    <ol class="wizard-steps" aria-label="Benchmark setup steps">
      <li aria-current="step">1. Target</li><li>2. Connection</li><li>3. Benchmark</li><li>4. Review</li>
    </ol>
    <div id="wizard-error" class="wizard-error" role="alert" tabindex="-1" hidden></div>
    <section data-wizard-step="0" aria-labelledby="wizard-target-title">
      <h3 id="wizard-target-title" tabindex="-1">Where is your database?</h3>
      <fieldset class="wizard-segmented"><legend class="wizard-sr-only">Database location relative to HammerDB</legend>
        <label><input type="radio" name="location" value="local" checked><span>This instance</span></label>
        <label><input type="radio" name="location" value="remote"><span>Remote database</span></label>
      </fieldset>
      <p id="wizard-location-help">The database runs on the same server as HammerDB, for example the HammerDB Cloud EC2 instance.</p>
      <fieldset id="wizard-local-mode"><legend>How would you like to use this instance?</legend>
        <label><input type="radio" name="target_mode" value="existing" checked> Use an already-running database</label>
        <label><input type="radio" name="target_mode" value="source"> Provision using existing Pipeline</label>
      </fieldset>
      <p id="wizard-source-help" hidden>Use the existing source-build Pipeline below. Its supported databases, validated source references and Single/Profile/Compare controls are unchanged. Source provisioning requires the existing Linux CI backend. <a href="#existing-pipeline" id="wizard-existing-link">Open existing Pipeline</a></p>
      <div id="wizard-endpoint-choice" class="wizard-grid">
        <label>Database <select id="wizard-database" name="database"></select></label>
        <label>Workload <select id="wizard-workload" name="workload"></select></label>
      </div>
      <p id="wizard-library-status" role="status"></p>
    </section>
    <section data-wizard-step="1" aria-labelledby="wizard-connection-title" hidden>
      <h3 id="wizard-connection-title" tabindex="-1">Connect to an existing database</h3>
      <p>No database software is installed and no target service is started or stopped.</p>
      <label>Operator connection profile <input id="wizard-profile" name="connection_profile" autocomplete="off" spellcheck="false" placeholder="For example postgres-test" required></label>
      <p class="wizard-help">Enter an operator-managed profile reference. Passwords stay in the deployment’s credential configuration. This preview does not validate credentials or contact the database.</p>
      <div id="wizard-connection-fields" class="wizard-grid"></div>
    </section>
    <section data-wizard-step="2" aria-labelledby="wizard-benchmark-title" hidden>
      <h3 id="wizard-benchmark-title" tabindex="-1">Choose benchmark operations</h3>
      <fieldset class="wizard-segmented"><legend class="wizard-sr-only">Workflow</legend>
        <label><input type="radio" name="workflow" value="benchmark" checked><span>Run Benchmark</span></label>
        <label><input type="radio" name="workflow" value="operations"><span>Individual Operations</span></label>
      </fieldset>
      <div id="wizard-simple-operations"><p>Check the existing schema, then run the benchmark. An existing schema is never deleted or rebuilt automatically.</p>
        <label><input type="checkbox" id="wizard-build-schema"> Build a new benchmark schema first</label>
      </div>
      <fieldset id="wizard-individual-operations" hidden><legend>Choose operations in execution order</legend>
        <label><input type="checkbox" name="operation" value="buildschema"> 1. Build Schema</label>
        <label><input type="checkbox" name="operation" value="checkschema" checked> 2. Check Schema</label>
        <label><input type="checkbox" name="operation" value="run" checked> 3. Run Benchmark</label>
        <label><input type="checkbox" name="operation" value="deleteschema"> 4. Delete Schema</label>
      </fieldset>
      <div id="wizard-build-confirmation" hidden><label><input type="checkbox" id="wizard-confirm-build"> I authorise schema creation on the connection target shown in the review.</label></div>
      <div id="wizard-delete-confirmation" class="wizard-destructive" hidden>
        <p>Deletion removes the benchmark schema. Confirm the exact target and schema/database:</p>
        <p><strong id="wizard-delete-target"></strong></p>
        <label>Type the target above <input id="wizard-delete-text" autocomplete="off" spellcheck="false"></label>
        <label><input type="checkbox" id="wizard-confirm-delete"> I authorise deletion of this specific schema on this target.</label>
      </div>
      <div id="wizard-essential-fields" class="wizard-grid"></div>
      <div id="wizard-run-options">
        <div class="wizard-grid">
          <label>Benchmark driver virtual users <input type="number" min="1" step="1" id="wizard-driver-vu" value="1"></label>
          <label>Run mode <select id="wizard-run-mode"><option value="single">Single</option><option value="profile">Increasing concurrency profile (TPROC-C preview)</option></select></label>
        </div>
        <p class="wizard-help">Driver virtual users, schema-building virtual users, profile concurrency points and Max AVU are separate settings. TPROC-C timed drivers include a monitor user; TPROC-H query users follow the workload’s own semantics.</p>
        <fieldset class="wizard-segmented"><legend>Max AVU</legend>
          <label><input type="radio" name="avu_mode" value="auto" checked><span>Auto</span></label>
          <label><input type="radio" name="avu_mode" value="manual"><span>Manual</span></label>
        </fieldset>
        <p id="wizard-auto-help"></p>
        <div id="wizard-manual-avu" hidden>
          <label>Max AVU <output id="wizard-avu-value" for="wizard-avu-slider wizard-max-avu">1</output><input id="wizard-avu-slider" type="range" min="1" max="24" step="1" value="1"></label>
          <label>Exact Max AVU <input id="wizard-max-avu" type="number" min="1" step="1" value="1"></label>
          <p class="wizard-help">The slider is an editing window, not a supported backend limit. Larger integer values can be entered precisely. The enhanced CI backend must validate effective limits.</p>
        </div>
        <label id="wizard-profile-points-label" hidden>Profile concurrency points <input id="wizard-profile-points" autocomplete="off" spellcheck="false"></label>
      </div>
      <details id="wizard-advanced"><summary>Advanced Settings</summary>
        <p>Supported per-benchmark options use the existing HammerDB configuration names. Deployment settings and credentials remain operator-managed.</p>
        <div id="wizard-advanced-fields" class="wizard-grid"></div>
      </details>
      <label class="wizard-share"><input id="wizard-share-result" type="checkbox" checked> Share result to HammerDB leaderboard</label>
      <p class="wizard-help">Successful canonical results can be prepared for the public community leaderboard through GitHub’s contribution workflow. This preview makes no GitHub changes; sharing awaits authorised backend support.</p>
    </section>
    <section data-wizard-step="3" aria-labelledby="wizard-review-title" hidden>
      <h3 id="wizard-review-title" tabindex="-1">Review benchmark request</h3>
      <div id="wizard-review"></div>
      <details><summary>Proposed structured request (credentials redacted)</summary><pre id="wizard-request-json"></pre></details>
      <p>No Pipeline or Job has been created. The authenticated enhanced <code>/cihook</code> adapter will validate the request and capture exact operation and Job IDs in Stage 2.</p>
      <button type="button" id="wizard-preview">Preview execution</button>
      <p id="wizard-status" role="status" tabindex="-1"></p>
    </section>
    <div class="wizard-actions"><button type="button" id="wizard-back" hidden>Back</button><button type="button" id="wizard-next">Continue</button></div>
  </form>
</section>
<script src="%url($B/pipeline-wizard.js)" defer></script>
        }
    }
}
namespace import pipelinewizard::*
