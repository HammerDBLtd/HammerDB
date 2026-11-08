# ASH in Pipelines and Jobs

Development branch: `feature/6.2-ash`, based directly on `master`.
Target: databases built and started by HammerDB Pipelines on Linux EC2 hosts.
Amazon RDS, the deferred Stage 1 wizard, and the MCP integration are out of scope.
The previous wizard work is preserved separately on
`feature/6.2-deferred-wizard-rds`; it is not included in this branch.

## Governing reuse map

The existing desktop implementation is authoritative. This feature does not
sample `pg_stat_activity` or Performance Schema in a new application poller.

| Existing source | Reused implementation |
| --- | --- |
| `src/postgresql/pgmet.tcl` | `pg_dbmon_thread_init`, native connection/query worker, `mon_loop`, `set_pgcursors`, wait dictionaries, native ASH selection and percentage rules |
| `src/mysql/mysqlmet.tcl` | `mysql_dbmon_thread_init`, native worker, `mon_loop`, `set_mysqlcursors`, existing `hammerdb_ash.ash_sampler` SQL and its five-second schedule |
| `src/mariadb/mariamet.tcl` | Native MariaDB connector and the corresponding existing sampler, cursor catalog and monitor loop |
| `src/villagesql/vsqlmet.tcl` | Existing MySQL namespace aliases, without an additional VillageSQL collector |
| `modules/ashcapture-1.0.tm` | Shared extraction of the existing MySQL-family setup SQL; headless sink on the existing workers/refresh loop; raw transfer and lifecycle integration |
| `modules/ashreplay-1.0.tm` | Executes the original cursor templates against archived native rows, adapting SQL dialect syntax for SQLite; pure helpers shared with desktop selection/percentage rendering |
| `modules/ashstore-1.0.tm` | Indexed, batched, per-Job archival storage and additive migration; no sampling or replacement score calculations |

The server-side samplers retain their existing cadence: pg_sentinel's configured
one-second period and the MySQL-family five-second event. The existing monitor's
15-second fast / 60-second slow refresh transfers their output into Jobs.
Chart AAS weights observations using their native sampling period and the observed
time span plus one period, including partial windows. SQL-over-time also weights
MySQL-family observations by five seconds and uses a common timestamp for all
wait classes in a bucket, preventing category-dependent divisors. Wait-event
shares and raw sample counts are unchanged. Archived Jobs retain their originally
captured chart values; the new chart normalization applies to future refreshes.
Desktop Tk initialization is guarded only when a provider is loaded headlessly.
The desktop still uses its existing workers, queries, graph and table callbacks.

## Enable and execute

Select **ASH Metrics** (immediately to the right of the I/O option) in the existing Pipelines **Run
Benchmark** form. It defaults to unchecked and is supported for PostgreSQL,
MySQL, MariaDB and VillageSQL. The existing supported Single, Profile and Compare
workflows carry `collect_ash: 0|1` through the listener and `JOBCI` into the runner.
The appended optional CLI argument is:

```tcl
cipush refname ?pipeline? ?workload? ?dbprefix? ?io_intensive? ?collect_ash?
```

The runner scopes `HAMMERDB_ASH` to the selected pipeline. Capture starts only
after `vurun` has created the exact benchmark Job ID, before its workload begins.
Each profile iteration and Compare side has its own Job and archive. Schema-only
Jobs are not misidentified as benchmark runs. Capture errors and unsuccessful
benchmark child exits fail the pipeline; acceptance/spawning is not completion.

## Manual capture from Tcl, Python and Desktop GUI

The existing Pipeline runner calls `::ashcapture::start` and
`::ashcapture::stop` automatically for opted-in benchmark Jobs.
The public `ashstart`, `ashstop`, and `ashstatus` commands are now
available in both Tcl CLI and the Python CLI (through the existing
`tclpy` bridge); they use **the same native ASH collector**, with no
new sampler or modification to the Desktop ASH monitor.

**Ordinary benchmark scripts are intentionally untouched.** ASH does not
start for them unless an operator explicitly requests it. Web Service
Pipelines are different: `collect_ash=1` sets `HAMMERDB_ASH=1` for the
newer Single/Profile/Compare runner; the existing `vurun` starts ASH
before benchmark execution and flushes it afterward. Do **not** put
`ashstart`/`ashstop` in those Pipeline scripts as well, since this
would run a second collector. The four databases' Tcl/Python
`*_run_profile` scripts document this in their headers.

To opt into ASH in a **separate manual Tcl script** (`./hammerdbcli tcl`),
first configure the database with `dbset`/`diset` as normal, then:

```tcl
loadscript
vuset vu vcpu
vucreate
set ash_job [ashstart]
puts [ashstatus]
try {
    set benchmark_job [vurun]
} finally {
    # Stop ASH even if the benchmark reports an error.
    try {puts [ashstop]} finally {vudestroy}
}
puts [ashstatus]
```

The corresponding **manual Python CLI** commands (`./hammerdbcli python`)
use the same Tcl collector, through the existing `tclpy` bridge:

```python
loadscript()
vuset("vu", "vcpu")
vucreate()
print(ashstart())
print(ashstatus())
try:
    result = vurun()
finally:
    try:
        print(ashstop())
    finally:
        vudestroy()
print(ashstatus())
```

These blocks are **explicit opt-in examples**, not changes to any
regular HammerDB run script.

`ashstart` creates a persistent Job and reports its ID. A subsequent
`vurun` reuses this Job ID, rather than creating a second unrelated Job.
`ashstart existing_jobid` in Tcl can attach to a matching existing
benchmark Job, provided that Job has not already recorded ASH.
`ashstatus ?jobid?` reports a historical Job's state and sample count.
Automatic Pipeline capture and manually started capture cannot be
combined for the same run; `ashstop` finishes only manual capture.

In the Desktop GUI, use **Options > ASH Capture > Start / Stop / Status**.
Starting capture before running the benchmark registers the Job first;
the GUI Run action reuses the same Job. Starting during an already
running GUI benchmark attaches to that current Job. Stop after the run
to flush the last native samples; exiting the GUI also flushes manual
capture before killing threads. Existing Desktop Metrics and ASH display
logic are not replaced.

The Jobs database must be **on disk**, enabled, and shared with the
HammerDB Web Service. In-memory Jobs storage is rejected rather than
silently losing the archive. Browse the recorded Job via
`/jobs?jobid=JOB_ID&ash` (or its ASH section in the Jobs UI).

The two ASH infrastructure threads are excluded from CLI, GUI, Autopilot
and TPROC-C timing virtual-user accounting. ASH startup temporarily
suspends and then restores the interactive Tcl stdin fileevent during its
readiness wait, preventing the recursive TclReadLine hang documented in
TPC-Council/HammerDB issue #967. There is no new CLI `vwait` with an
active stdin handler. The direct commands are currently restricted to
PostgreSQL, MariaDB, MySQL and VillageSQL. **Oracle is phase 2.**

PostgreSQL ASH builds and installs matching `pg_stat_statements` plus pinned
pg_sentinel revision `145e73f738821b1fe36575c728635dd7aba26a6a`, preloads them,
and activates both extensions in the configured monitoring database. The
configuration retains the desktop's documented 1,000,000-entry ASH ring. It uses
the pinned extension's supported `pgsentinel_ash.sampling_period` setting rather
than the obsolete `pull_frequency` name. Installation, preload or activation
failure prevents workload execution; there is no alternate collector.

MySQL-family builds/startup enable Performance Schema and the event scheduler. Strict headless setup
reuses the desktop schema/event SQL and verifies the required consumers,
instruments and scheduler before execution. Shared server instrumentation remains
available after a Job ends, as in the desktop. Ending one Job stops and flushes
only its archive transfer and closes its own worker connections; it does not drop
a shared sampler or disable a scheduler used by another monitor.

## Storage and historical analysis

`JOBASH` preserves complete native sample dictionaries, native timestamps,
SQL/session identifiers, SQL text, SQL NULL markers, source collation comparison
keys and supporting metadata. `JOBASHINFO` records per-Job lifecycle and native
clock information. Native SQL-statistics snapshots and canonical chart refresh
rows are retained separately. Complete snapshot markers are atomic, including
empty snapshots following a Performance Schema reset. Chart row ordering is
retained because the desktop's first point in a reused bucket determines its
selection IDs.

Migration is additive for existing Jobs databases, including the new
`JOBCI.collect_ash` column. Job deletion removes its ASH archive. Writes are
transactional and historical time ranges use indexed access. The archive must be
an on-disk Jobs database for worker connections to share it.

Only Jobs with an ASH capture record show the **ASH** menu entry; schema
Jobs and older Jobs without ASH do not. The initial view covers the full
capture of the selected benchmark Job, never ASH history from another Job.
Drag across the chart to select a time window; double-click to reset to that
Job's full capture. A collapsed **Custom time window** section optionally
accepts local From/To timestamps for workloads run back-to-back, while still
remaining within the selected Job's recording.

Browser dragging sends pointer coordinates to Tcl; the shared desktop selection
helper resolves native bucket/sample bounds and inclusive SQL predicates.
The Web Service ASH timeline defaults to a continuous stacked step-area chart:
each 15-second bucket shows the sum of its recorded wait classes as total AAS.
Bands step at bucket boundaries without interpolating or smoothing missing
samples, and gaps remain blank. An **Area / Bars** switch restores the
Desktop-style overlapping bars for comparison, without changing source data.
Both modes and the lower SQL, wait and session activity bars use the same
Desktop wait-class colours, including classified MySQL-family waits. Selecting a row requests only matching SQL, event or
session samples using compound (jobid,source,identifier,sample_time) SQLite
indexes, retaining the existing overview in the browser. The selected SQL
activity-over-time plot belongs to that SQL ID only. The browser uses the native
Desktop query templates and shared activity calculations. The CPU reference is
explicitly the **driver-host** CPU count, not database-host utilization.
Background events such as autovacuum may have a captured wait but no SQL text
to display; this is reported as missing SQL text, not a failed ASH archive.

While capture is active the view refreshes the benchmark summary every 15
seconds, including when a row is selected. Once complete, the same archive
supports browsing without a running database. Routes are
`/jobs?jobid=ID&ash` and `/jobs?jobid=ID&ashdata`, with optional
`detailonly=1` for indexed drill-downs. Selection bounds are finite Unix
seconds. A request exceeding 250,000 selected raw samples asks for a narrower
window rather than silently truncating data. All captured data remains stored.
The two ASH infrastructure threads are explicitly excluded from TPROC-C
virtual-user numbering so they cannot create nonexistent timing-profile slots.

## Validation and limits

Focused tests are in `tests/ashstore.test`, `ashcapture.test`, `ashreplay.test`,
`ashpipeline.test`, `ashproviders.test` and `ashrunner.test`. They exercise
migrations, native worker integration, exact identities, Profile/Compare
subprocesses, disabled behavior, failures/cancellation, shared sampler lifetime,
NULLs, collation keys, SQL snapshots, selection bounds and child exit status.
Database build/compiler boundaries in the provider tests are explicit fixtures.

Run each Tcl test with a suitable interpreter and the native SQLite/Thread
packages. Request/JSON tests require Tcl 9; the capture tests also support
Tcl 8.6. Each test file exits nonzero on failure. Existing Pipelines tests remain regression checks.

Historical baseline verification on Linux with Tcl 9.0.1 (prior to the
ASH reporting changes):

| Suite | Passed | Failed / skipped |
| --- | ---: | ---: |
| `ashstore.test` | 13 | 0 / 0 |
| `ashcapture.test` | 18 | 0 / 0 |
| `ashreplay.test` | 41 | 0 / 0 |
| `ashproviders.test` | 17 | 0 / 0 |
| `ashrunner.test` | 24 | 0 / 0 |
| `ashpipeline.test` | 49 | 0 / 0 |
| Existing `pipelines.test` / `wizardconfig.test` on the original combined branch | 35 | 0 / 0 |
| Existing JavaScript wizard suites on the original combined branch | 71 | 0 / 0 |
| Chromium Jobs/ASH integration checks | 6 | 0 / 0 |

The browser checks cover real mouse selection, SQL/event/session drill-downs,
inert display of hostile SQL text, truthful empty states, live updates, stopped
polling after completion, and reopening persisted history. The native-worker
capture suite also passes under Tcl 8.6.16. `git diff --check` passes.

The Chromium integration test runs real Wapp Jobs routes, SQLite and the new
renderer using clearly synthetic archived samples:

```sh
tclsh9.0 tests/ashjobs-server.tcl 8097 /tmp/ash-browser-jobs.db
node tests/ashjobs.browser.js http://127.0.0.1:8097 /tmp/ash-browser-artifacts
```

It needs Playwright and Chromium; set `CHROMIUM_EXECUTABLE_PATH` or
`CHROMIUM_CDP_URL` when appropriate. The fixture server is a test-only local
service, not a production launcher.

For a completed native archive, run `tclsh tests/ash-offline.tcl captured-jobs.db
JOBID`. This snapshots the read-only SQLite source with `VACUUM INTO`, runs the actual Jobs report path,
and leaves the source archive unchanged. It can run with networking disabled
and without native database-client libraries. This check passed with the
captured PostgreSQL and MariaDB archives after collection completed.

Live local validation used PostgreSQL 17.11 with the pinned pg_sentinel and
MariaDB 11.8.6 with the existing sampler. A fresh PostgreSQL monitoring database
started without pre-created extensions. An 80-session workload persisted 1,125
samples by its first refresh and 1,425 by completion. Unchanged desktop SQL and
SQLite replay matched on seven PostgreSQL cursor cases and seven native MariaDB
cursor cases, plus 35 MariaDB cases covering NULLs, case/accent comparisons,
trailing spaces and selected-window boundaries. Native MySQL-protocol and
official MariaDB connector paths were exercised against the owned MariaDB server.

Standalone MySQL and VillageSQL servers have not been live-validated; fixtures
and shared-path checks are not evidence of independent live server support.
No production database, external credentials or upstream repository was used.
Full desktop GUI interaction has not been manually regression-tested on Windows.
These are reported Codex validation results from the original combined branch;
run the commands below again on the cleaned EC2 ASH branch.

After benchmark completion the collector attempts to capture up to 12 of the
most frequently sampled SQL IDs using EXPLAIN without ANALYZE. Plans are stored
with the ASH Job and can be viewed offline; SQL with unsupplied bind values,
unsafe multi-statements, missing SQL text or unsupported commands are explicitly
marked unavailable. Plan capture is best-effort and never runs SQL statements
or changes the benchmark result. Native nondeterministic
collations or missing comparison metadata that cannot be reproduced faithfully
raise an explicit error; replay never substitutes approximate grouping.

## EC2 acceptance procedure (clean ASH branch)

1. On a disposable Linux EC2 test host, check out `feature/6.2-ash` and
   verify its diff against `master` contains only the ASH implementation.
   Use an isolated test database and appropriate build tools and permissions.
2. Ensure HammerDB's Tcl 9, SQLite, Thread, database drivers and CLI / Web
   Service are installed. Run the focused tests from the repository root:

   ```sh
   for test in ashstore ashcapture ashreplay ashproviders ashrunner ashpipeline; do
     tclsh9.0 "tests/$test.test" || exit 1
   done
   ```

3. For the browser exercise, install Playwright and Chromium in your test
   environment, then run the local **synthetic-data** fixture in one terminal:

   ```sh
   tclsh9.0 tests/ashjobs-server.tcl 8097 /tmp/ash-browser-jobs.db
   ```

   In another terminal:

   ```sh
   node tests/ashjobs.browser.js http://127.0.0.1:8097 /tmp/ash-browser-artifacts
   ```

   Confirm the drag-selected window, event and SQL drilldowns, session
   selection, SQL-over-time chart, and saved-history reopening. The browser
   tests run against synthetic samples, not a live provisioned server.
4. Start the HammerDB Pipeline listener / Web Service using the host's
   normal EC2 configuration. In **Pipelines > Run Benchmark**, choose a
   PostgreSQL or MariaDB target, select **ASH Metrics** independently of I/O,
   and execute a short **Single TPROC-C** run.
   Verify the server actually starts with PostgreSQL preloads or MySQL-family
   `performance_schema=ON` and `event_scheduler=ON`, as applicable.
   Capture must begin before workload execution and fail visibly if its
   prerequisite cannot be enabled; it must not silently skip ASH.
5. Open the finished benchmark **Job > ASH** link. Check that sample counts,
   wait and SQL breakdowns, selected session details, SQL-over-time chart and
   drag-selection all update correctly. Reopen the same Job without a running
   database and confirm the saved view still works from the Jobs SQLite file.
   Ensure ASH tables are absent from exported benchmark reports/artifacts.
6. Repeat with ASH unchecked and I/O on, then I/O off and ASH on, to confirm
   independence. Repeat the selected ASH runs for Profile and Compare. Only
   after these pass, test against standalone MySQL and VillageSQL servers:
   they share existing provider paths but remain unverified live targets.

Note: the improved ASH collector attempts EXPLAIN (without ANALYZE) for
up to 12 frequently sampled SQL IDs after benchmark timing has finished and
before the source database is stopped. The plan and a capture status are
saved in JOBASH for later offline replay. Statements with unresolved bind
values or unsupported SQL are explicitly unavailable. Existing ASH archives
from before this change cannot gain historical plans retroactively. Do not
change the original Desktop SQL plan interaction.
