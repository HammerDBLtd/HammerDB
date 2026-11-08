# Remote benchmark target configuration preview. Live remote execution is not enabled.
package provide remotebenchmark 1.0
namespace eval remotebenchmark {
    namespace export wapp-page-remote-benchmark.js wapp-page-remote-benchmark.css wapp-page-remote-benchmark-config wapp-page-remote-benchmark-preview.js
    variable assetdir [file join [file dirname [info script]] .. src webservice]

    proc asset {name mimetype} {
        variable assetdir
        wapp-mimetype $mimetype
        set channel [open [file join $assetdir $name] r]
        try {wapp-unsafe [read $channel]} finally {close $channel}
    }
    proc wapp-page-remote-benchmark.js {} {
        asset remotebenchmark.js {text/javascript; charset=utf-8}
    }
    proc wapp-page-remote-benchmark-preview.js {} {
        asset remotebenchmark-preview.js {text/javascript; charset=utf-8}
    }
    proc wapp-page-remote-benchmark.css {} {
        asset remotebenchmark.css {text/css; charset=utf-8}
    }
    proc wapp-page-remote-benchmark-config {} {
        package require remotebenchmarkconfig 1.0
        wapp-mimetype {application/json; charset=utf-8}
        wapp-reply-extra Cache-Control no-store
        wapp-unsafe [remotebenchmarkconfig::metadata]
    }
    proc render {B} {
        wapp-subst {
<link rel="stylesheet" href="%url($B/remote-benchmark.css)">
<section id="hdb-remote-benchmark" data-remote-benchmark aria-labelledby="remote-title" data-config-url="%html($B/remote-benchmark-config)">
  <h2 id="remote-title">Benchmark targets: EC2 first, RDS next</h2>
  <p id="remote-mode-notice" class="remote-notice"><strong>Configuration preview</strong> — extend the existing local benchmark workflow to remote database targets. The self-managed EC2 environment comes first; RDS follows. This new setup view only simulates results; the existing source-build Pipeline below remains live.</p>
  <p id="remote-loading" role="status">Loading installation configuration…</p>
  <noscript><style>html #existing-pipeline[hidden]{display:block!important}</style><p>Enable JavaScript to use remote benchmark setup. The existing source-build Pipeline remains available below.</p></noscript>
  <form id="remote-form" hidden novalidate>
    <ol class="remote-steps" aria-label="Benchmark setup steps">
      <li aria-current="step">1. Target</li><li>2. Connection</li><li>3. Benchmark</li><li>4. Review</li>
    </ol>
    <div id="remote-error" class="remote-error" role="alert" tabindex="-1" hidden></div>
    <section data-remote-step="0" aria-labelledby="remote-target-title">
      <h3 id="remote-target-title" tabindex="-1">Where is your database?</h3>
      <fieldset class="remote-segmented"><legend class="remote-sr-only">Database location relative to HammerDB</legend>
        <label><input type="radio" name="location" value="local" checked><span>This instance (EC2 first)</span></label>
        <label><input type="radio" name="location" value="remote"><span>Remote database (RDS later)</span></label>
      </fieldset>
      <p id="remote-location-help">Start with the controlled, self-managed EC2 environment and existing local/source-build Pipeline. Managed RDS connections are a later phase.</p>
      <fieldset id="remote-local-mode"><legend>How would you like to use this instance?</legend>
        <label><input type="radio" name="target_mode" value="existing" checked> Use an already-running database</label>
        <label><input type="radio" name="target_mode" value="source"> Provision using existing Pipeline</label>
      </fieldset>
      <p id="remote-source-help" hidden>Use the existing source-build Pipeline below. Its supported databases, validated source references and Single/Profile/Compare controls are unchanged. Source provisioning requires the existing Linux CI backend. <a href="#existing-pipeline" id="remote-existing-link">Open existing Pipeline</a></p>
      <div id="remote-endpoint-choice" class="remote-grid">
        <label>Database <select id="remote-database" name="database"></select></label>
        <label>Workload <select id="remote-workload" name="workload"></select></label>
      </div>
      <p id="remote-library-status" role="status"></p>
    </section>
    <section data-remote-step="1" aria-labelledby="remote-connection-title" hidden>
      <h3 id="remote-connection-title" tabindex="-1">Connect to an existing database</h3>
      <p>No database software is installed and no target service is started or stopped.</p>
      <fieldset class="remote-segmented"><legend>Credentials</legend>
        <label><input type="radio" name="credential_mode" value="session" checked><span>Enter for this session</span></label>
        <label><input type="radio" name="credential_mode" value="profile"><span>Configured profile</span></label>
      </fieldset>
      <label id="remote-profile-label" hidden>Configured connection profile <select id="remote-profile" name="connection_profile"></select></label>
      <p id="remote-credential-help" class="remote-help">Passwords stay in this page’s memory and are discarded when the simulation starts or the target changes. Only placeholders reach the simulator; no credentials are checked.</p>
      <div id="remote-connection-fields" class="remote-grid"></div>
      <details id="remote-connection-advanced"><summary>Advanced connection settings</summary><div id="remote-connection-advanced-fields" class="remote-grid"></div></details>
    </section>
    <section data-remote-step="2" aria-labelledby="remote-benchmark-title" hidden>
      <h3 id="remote-benchmark-title" tabindex="-1">Choose benchmark operations</h3>
      <fieldset class="remote-segmented"><legend class="remote-sr-only">Workflow</legend>
        <label><input type="radio" name="workflow" value="benchmark" checked><span>Run Benchmark</span></label>
        <label><input type="radio" name="workflow" value="operations"><span>Individual Operations</span></label>
      </fieldset>
      <div id="remote-simple-operations"><p>Check the existing schema, then run the benchmark. An existing schema is never deleted or rebuilt automatically.</p>
        <label><input type="checkbox" id="remote-build-schema"> Build a new benchmark schema first</label>
      </div>
      <fieldset id="remote-individual-operations" hidden><legend>Choose operations in execution order</legend>
        <label><input type="checkbox" name="operation" value="buildschema"> 1. Build Schema</label>
        <label><input type="checkbox" name="operation" value="checkschema" checked> 2. Check Schema</label>
        <label><input type="checkbox" name="operation" value="run" checked> 3. Run Benchmark</label>
        <label><input type="checkbox" name="operation" value="deleteschema"> 4. Delete Schema</label>
      </fieldset>
      <div id="remote-build-confirmation" hidden><label><input type="checkbox" id="remote-confirm-build"> I authorise schema creation on the connection target shown in the review.</label></div>
      <div id="remote-delete-confirmation" class="remote-destructive" hidden>
        <p>Deletion removes the benchmark schema. Confirm the exact target and schema/database:</p>
        <p><strong id="remote-delete-target"></strong></p>
        <label>Type the target above <input id="remote-delete-text" autocomplete="off" spellcheck="false"></label>
        <label><input type="checkbox" id="remote-confirm-delete"> I authorise deletion of this specific schema on this target.</label>
      </div>
      <div id="remote-essential-fields" class="remote-grid"></div>
      <div id="remote-run-options">
        <div class="remote-grid">
          <label>Benchmark driver virtual users <input type="number" min="1" step="1" id="remote-driver-vu" value="1"></label>
          <label>Run mode <select id="remote-run-mode"><option value="single">Single</option><option value="profile">Increasing concurrency profile (TPROC-C)</option></select></label>
        </div>
        <p class="remote-help">Driver virtual users, schema-building virtual users, profile concurrency points and Max AVU are separate settings. TPROC-C timed drivers include a monitor user; TPROC-H query users follow the workload’s own semantics.</p>
        <fieldset class="remote-segmented"><legend>Max AVU</legend>
          <label><input type="radio" name="avu_mode" value="auto" checked><span>Auto</span></label>
          <label><input type="radio" name="avu_mode" value="manual"><span>Manual</span></label>
        </fieldset>
        <p id="remote-auto-help"></p>
        <div id="remote-manual-avu" hidden>
          <label>Max AVU <output id="remote-avu-value" for="remote-avu-slider remote-max-avu">1</output><input id="remote-avu-slider" type="range" min="1" max="1" step="1" value="1"></label>
          <label>Exact Max AVU <input id="remote-max-avu" type="number" min="1" step="1" value="1"></label>
          <p class="remote-help">The slider uses the configured concurrency range. Enter a larger whole number precisely when no installation limit is configured. Admission limits must be checked before a real run.</p>
        </div>
        <label id="remote-profile-points-label" hidden>Profile concurrency points <input id="remote-profile-points" autocomplete="off" spellcheck="false"></label>
      </div>
      <details id="remote-advanced"><summary>Advanced Settings</summary>
        <p>Optional benchmark settings use the installation’s native configuration names.</p>
        <div id="remote-advanced-fields" class="remote-grid"></div>
      </details>
      <label class="remote-share"><input id="remote-share-result" type="checkbox" checked> Share result to HammerDB leaderboard</label>
      <p class="remote-help">Successful results can be contributed to the public community leaderboard through GitHub. In simulation mode, preparation is simulated and nothing is published.</p>
    </section>
    <section data-remote-step="3" aria-labelledby="remote-review-title" hidden>
      <h3 id="remote-review-title" tabindex="-1">Review benchmark request</h3>
      <div id="remote-review"></div>
      <details><summary>Proposed structured request (credentials redacted)</summary><pre id="remote-request-json"></pre></details>
      <p>The next action runs a simulation only. Simulated Pipeline and Job IDs are labelled <code>SIM-</code>; they are not real benchmark results.</p>
      <label>Test outcome <select id="remote-scenario"><option value="success">Successful workflow</option><option value="rejection">Request rejected</option><option value="failure">Operation failure</option><option value="timeout">Status timeout and recovery</option><option value="partial">Partial profile results</option><option value="cleanup_failure">Cleanup failure after benchmark</option><option value="sharing_failure">Sharing failure after benchmark</option></select></label>
      <div class="remote-actions"><button type="button" id="remote-preview">Start simulated run</button><button type="button" id="remote-cancel" hidden>Cancel simulated run</button><button type="button" id="remote-retry-status" hidden>Retry status</button></div>
      <p id="remote-status" role="status" tabindex="-1"></p>
      <section id="remote-progress" aria-labelledby="remote-progress-title" hidden>
        <h4 id="remote-progress-title">Simulated execution</h4>
        <p id="remote-pipeline-id"></p>
        <ol id="remote-operation-progress"></ol>
        <div id="remote-simulated-jobs"></div>
        <p id="remote-sharing-status"></p>
        <a id="remote-download" hidden download="hammerdb-simulated-result.json">Download simulated result JSON</a>
      </section>
    </section>
    <div class="remote-actions"><button type="button" id="remote-back" hidden>Back</button><button type="button" id="remote-next">Continue</button></div>
  </form>
</section>
<script src="%url($B/remote-benchmark-preview.js)" defer></script>
<script src="%url($B/remote-benchmark.js)" defer></script>
        }
    }
}
namespace import remotebenchmark::*
