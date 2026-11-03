# HammerDB 6.2 Web Service wizard — Stage 1

Stage 1 implements guided configuration and the execution **user interface**.
The new existing-database workflow uses explicit browser-only response fixtures.
It never contacts a database, executes benchmark/schema commands, creates real
Jobs, or writes to GitHub. Simulated Pipeline/Job identities start with `SIM-`;
fixture reports contain no measured performance scores.

The original source-build Pipeline retains its **live** CI behaviour. Select
**This instance → Provision using existing Pipeline** to expose its original
controls. A live-execution notice distinguishes it from the simulated endpoint
wizard. Only one workload selector is active at a time. Jobs, Pipelines and
Pipeline Activity remain available.

## Build and manually test

The branch is `feature/6.2-mcp` in `HammerDBLtd/HammerDB`. Update an existing
checkout without discarding local changes:

```sh
git fetch origin feature/6.2-mcp
git switch feature/6.2-mcp
git pull --ff-only origin feature/6.2-mcp
```

Build using the normal HammerDB source-build procedure and start `hammerdbws`
from the resulting distribution directory. Open Pipelines. BAWT packaging retains
the Tcl modules and all three wizard assets under `src/webservice` in both the
development distribution and packaged Web Service.

### Existing database workflow

1. Choose **This instance → Use an already-running database**, or **Remote
   database**. Select a database family and TPROC-C or TPROC-H.
2. Continue to Connection. **Enter for this session** is the default; there is
   no required invented profile name. Supply native connection fields and an
   optional test password. Credentials are not checked during simulation.
3. On Benchmark, use the default existing-schema Check/Run workflow, optionally
   authorise Build Schema first, or select Individual Operations. Configure
   scale, driver, timing, VUs, Max AVU and optional Advanced Settings.
4. Review the plan. Password values must be absent from the summary and JSON.
   Choose **Successful workflow → Start simulated run**.
5. Inspect queued/running/completed progress, operation-specific simulated Job
   IDs, Job details and the simulated JSON download. Sharing preparation is
   separately identified as a simulation; it never creates a contribution.

For a profile, select TPROC-C, **Increasing concurrency profile**, and increasing
concurrency points. Each point receives a separate simulated Job. TPROC-H keeps
its query-user semantics and does not use a TPROC-C throughput profile.

### Individual operations and confirmation

Build, Check, Run and Delete can be selected in execution order. Build requires
explicit authority. Delete requires authority plus a typed confirmation of the
actual endpoint, port/socket and schema/database. Db2 identifies the workload's
catalogued database alias. If an operation needs more Connection fields, Review
returns to Connection so they can be supplied. No real schema operation runs.

### Failure and recovery

Choose a **Test outcome** on Review:

| Outcome | Expected simulated behaviour |
| --- | --- |
| Successful workflow | Selected operations complete with exact simulated Job IDs. |
| Request rejected | A rejection appears without Pipeline/Jobs; deliberate retry is available. |
| Operation failure | Prior successful Jobs remain; later operations are skipped. |
| Status timeout and recovery | Retry status resumes the same Pipeline without duplicate submission. |
| Partial profile results | Requires a profile with at least two points; successful/failed Jobs stay separate. |
| Cleanup failure after benchmark | Explicitly include Delete Schema; benchmark success survives cleanup failure. |
| Sharing failure after benchmark | Benchmark remains completed; sharing preparation fails separately. |

Cancel an in-progress simulation. Start stays disabled during submission/polling;
another deliberate run gets a new identity. Turning sharing off prevents even
simulated preparation. Schema-only operations have no contribution to prepare.

Also check Back/Continue after an invalid duration or empty operation selection:
validation is scoped to the current step, so the setting remains reachable for
correction. JavaScript-loading and metadata failures leave the original Pipeline
accessible. Editing prevents periodic refresh from discarding wizard state.

## Native settings and credentials

Families, workloads, keys and defaults come from the current HammerDB config.
Descriptors expose essential fields and focused Advanced Settings, without new
drivers. Tcl adapter loading and native SQL Server ODBC-driver availability are
reported separately. Missing clients are labelled configuration/simulation-only.

The wizard includes native SQL Server SQL/Windows/Entra and Azure options;
MySQL-family TLS CA, certificate, key-file references and cipher options; Oracle
service/RAC; and Db2 workload aliases. RAC uses native `1`/`0`. Timed-only flags
are cleared when switching to the test driver. Async and refresh dependencies
are respected. Inactive settings are omitted, except explicit empty overrides
that clear native certificate/key defaults for one-way TLS. Client files are not
read by the wizard, and pasted key/certificate contents are rejected.

Password descriptors start empty: persisted passwords are never returned by
metadata. Session passwords remain only in page memory and are cleared when a
simulation starts, on target/credential-mode changes, and on page exit. The
simulator receives group-qualified references such as `session:tpcc.pg_pass`,
never password values. Repeated simulations reuse the sanitized reviewed plan,
without retaining passwords; editing requires review again. Passwords do not
enter URLs, browser storage, summaries, downloads or simulated responses.

Configured profiles are offered only if capability metadata supplies them. The
current deployment has no profile resolver, so that choice is disabled when
none are supplied. Profile resolution and live credential transport belong to
Stage 2; Stage 1 introduces no credential service.

Schema-builder VUs, driver VUs, profile points and Max AVU remain distinct.
Auto shows the configured sequence and ceiling when known, without claiming a
measured optimum or machine admission limit. Manual provides a slider and exact
integer input, without inventing a backend maximum.

## Integration boundary

The browser builds versioned `pipeline: custom` proposals with native `diset`
groups and `vuset`. The separate in-memory test adapter exposes asynchronous
`submit`, `status`, `result` and `cancel` responses. It is a fixture adapter, not
a CI service, scheduler, benchmark engine or results database. Downloaded fixture
JSON is explicitly simulated and cannot be used as a measured canonical result.

`/pipeline-wizard-config` serves read-only metadata with `preview: true` and
`custom_execution: false`. The new wizard does not POST to `/cihook`.

Stage 2 must connect the UI to the existing authenticated enhanced CI interface:
authoritative validation, secure credentials, native `hammerdbcli auto`, admission
and idempotency, real asynchronous status, exact real Pipeline/Job association
and original canonical Jobs JSON. MCP, real analysis and authorised contributor
fork work remain later stages. Nothing writes to TPC-Council or creates a PR.

## Automated validation

With the normal Tcl 9 runtime/libraries and Node available:

```sh
tclsh9.0 tests/wizardconfig.test
tclsh9.0 tests/pipelines.test
node --test --test-isolation=none tests/pipelinewizard.test.js tests/pipelinewizard-mock.test.js
```

Browser tests additionally need existing Playwright/Chromium and an isolated test
Web Service with no CI listener:

```sh
node tests/pipelinewizard.browser.js http://127.0.0.1:8080 /workspace/artifacts
```

Tests distinguish actual Wapp rendering/native configuration fixtures from mock
execution. They must never submit the existing live source-build form or perform
benchmark/database/GitHub writes. Source builds, native Windows execution and
real database integration need separate validation.
