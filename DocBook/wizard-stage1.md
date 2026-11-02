# HammerDB 6.2: Web Service wizard, Stage 1

The Pipelines page now starts with a guided existing-database configuration
preview. Selecting **This instance → Provision using existing Pipeline** shows
the existing source-build Pipeline below it, with
its original database, source reference, Single, Profile, Compare and I/O
controls. Endpoint and source-build workload selectors are mutually exclusive;
inactive source-build controls are hidden and disabled. Existing Pipeline query
links restore source-build mode when the page reloads. Jobs and Pipelines
navigation are unchanged. Without JavaScript, or if wizard metadata cannot load,
only the original source-build controls are offered.

## What is available

- **This instance** offers an already-running database or a handoff to the
  existing source-build Pipeline. **Remote database** configures an existing
  endpoint; it does not provision a database.
- Database families, workloads and native option names/defaults come from the
  current HammerDB configuration. Client-library load status is shown separately
  from backend support. An unavailable client permits a clearly labelled
  configuration preview only.
- Connection fields use the existing database-specific names. Passwords are
  never accepted by this preview. An operator connection-profile reference
  represents credentials that the future authenticated backend must resolve and
  authorise. The profile mechanism itself is not implemented in Stage 1.
- Run Benchmark checks the existing schema and runs it. Optional schema creation
  requires explicit authority. Individual Operations selects Build, Check, Run
  and Delete in that order. Delete requires both authority and a typed target
  confirmation, including endpoint, port/socket, schema/database and profile.
- Schema-builder VUs, benchmark-driver VUs, profile points and Max AVU remain
  separate. Auto refers to existing Autopilot/profile configuration for TPROC-C;
  TPROC-H retains workload-specific semantics. No backend maximum is invented.
  The Manual slider has an adjustable editing window; precise larger values can
  be entered numerically, subject to future backend admission checks.
- Advanced Settings exposes a small set of existing options and respects field
  dependencies. Inactive values are omitted from requests.
- Sharing is enabled by default and appears in the review. It records a
  preference only; this stage never contacts GitHub.

The review and **Preview execution** action do not submit requests, create
Pipelines/Jobs, run Tcl or contact a database. No fake success or result IDs are
displayed. Existing source-build controls retain their pre-existing live
behaviour; they are distinct from the new preview.

## Proposed request boundary

The browser builds a versioned JSON **proposal**, pending Stage 2 validation of
the shared enhanced `/cihook` contract:

```json
{
  "api_version": "1",
  "pipeline": "custom",
  "database": "pg",
  "workload": "C",
  "target": {
    "mode": "existing",
    "location": "remote",
    "connection_profile": "postgres-test"
  },
  "operations": ["checkschema", "run"],
  "diset": {
    "connection": {"pg_host": "database.example", "pg_port": 5432},
    "tpcc": {"pg_dbase": "tpcc", "pg_driver": "timed"}
  },
  "run_mode": "single",
  "vuset": {"vu": 1},
  "max_avu": {"mode": "manual", "maximum": 8},
  "share_result": true
}
```

Actual previews include active native defaults and optional profile/confirmation
objects. Connection usernames are redacted in the review JSON. Secrets are
excluded at the metadata source, and credential-bearing persisted defaults are
blanked. State stays in the current page; it is not placed in URLs or browser
storage. Editing prevents the existing automatic page refresh from discarding
the form.

`/pipeline-wizard-config` serves read-only installation presentation metadata
with `preview: true` and `custom_execution: false`. It is **not** the future
authoritative CI capability API. Browser validation is for configuration
feedback, not a security boundary for a future execution endpoint.

Stage 2 must implement authorised profiles and targets, authoritative option and
operation validation, effective AVU/profile semantics, safe native CLI script
orchestration, admission/idempotency, asynchronous status, exact Job correlation
and canonical results. Sharing and MCP implementation remain later stages.

## Focused validation

With the normal HammerDB Tcl 9 runtime and libraries available:

```sh
tclsh9.0 tests/wizardconfig.test
tclsh9.0 tests/pipelines.test
node --test --test-isolation=none tests/pipelinewizard.test.js
```

The Tcl tests use real repository XML fixtures and mock library availability
where stated. Node tests use representative capability fixtures. Neither runs
benchmarks or schema operations.

The optional browser check requires Playwright and Chromium already available,
and a local Web Service instance started with isolated temporary configuration
and Jobs storage:

```sh
node tests/pipelinewizard.browser.js http://127.0.0.1:8080 /workspace/artifacts
```

The browser test exercises the actual Wapp pages and uses local metadata or
explicitly mocked metadata as identified in its output. It must never activate
the existing live source-build Run Benchmark button. No database installation,
source build or GitHub write is needed for these UI checks.
