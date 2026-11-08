# Local-to-remote database benchmarks — EC2 first, RDS next

**Status:** Future development, outside the December 2026 6.1.1-cloud MVP.
**Integration path:** develop in open source, validate on controlled EC2, then expand
to Amazon RDS and include the completed work in the appropriate future release.

## Goal

Extend the **existing** HammerDB local/source-build benchmark workflow to
additional database targets. Keep the existing Pipelines and Jobs interfaces,
workloads, native settings, and canonical results. This is not a separate AI
assistant, not a new provisioning system, and not a competing execution engine.

## Delivery order

1. **Existing local tests remain unchanged.** The current source-build
   Pipeline continues to run live on its supported platforms.
2. **Controlled self-managed EC2 first.** Validate target configuration,
   database connections, permissions, schema operations and benchmark execution
   in an environment we operate and can reproduce.
3. **Managed Amazon RDS second.** Reuse the proven flow for an already-running
   remote database endpoint. Address network/security configuration, credentials,
   supported engine options, execution limits, and clearly authorized schema
   operations. Do not assume RDS has the same administrative rights as EC2.

## What this branch contains today

The earlier Stage 1 configuration prototype has been carried forward and renamed
**Remote benchmark setup**. It allows a user to select an existing database,
enter connection settings, choose operations, review a structured request and
explore simulated status/results. It uses the installation's native settings.

**Important:** The new remote-target path is a **configuration preview**, not
a live RDS or EC2 benchmarking implementation. The preview adapter uses only
in-memory simulated responses and never executes a database or schema operation,
creates a real Job, or publishes results. Simulated IDs begin with `SIM-`.
The original source-build Pipeline remains the *only* live execution path in
this branch.

Credentials remain in page memory during configuration; preview requests use
only placeholders. There is not yet a secure remote execution/credential
transport or a remote benchmark runner. No performance measurements should be
inferred from preview responses.

## Future execution integration

Connect remote target configuration to the existing authorized Pipeline/Jobs
execution flow, rather than adding a parallel runner. Before enabling real runs:

- Validate remote endpoint reachability and engine-specific support.
- Add an approved credential handoff without recording passwords in Jobs,
  URLs, logs, browser storage or preview payloads.
- Require explicit confirmation for schema creation and deletion; keep the
  existing schema as the default.
- Enforce controlled operation and concurrency limits appropriate to EC2/RDS.
- Show actual job identifiers, operation status and canonical benchmark results.
- Keep source-build Pipeline behavior unchanged; route any new remote behavior
  only when explicitly selected.

The feature is deliberately separate from the AI Assistant. The UI should use
**Benchmark targets**, **Connection**, **Operations**, and **Review** terminology,
not an additional assistant or guided automation concept.

## Relevant implementation files

- `modules/remotebenchmark-1.0.tm` — Web Service presentation and asset routes
- `modules/remotebenchmarkconfig-1.0.tm` — read-only native configuration metadata
- `modules/pipelines-1.0.tm` — existing Pipeline integration
- `src/webservice/remotebenchmark.js` — configuration/review UI
- `src/webservice/remotebenchmark.css` — page styling
- `src/webservice/remotebenchmark-preview.js` — non-executing response preview

No new automated test files or infrastructure are included with this branch.
