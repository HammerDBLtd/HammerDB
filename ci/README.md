# HammerDB pre-release CI

This is **application source CI** for HammerDB, separate from HammerDB's built-in database-provider CI (`config/ci.xml`) and the version-specific Docker release/promotion workflows.

## Automatic checks

The **HammerDB pre-release CI** workflow runs on pull requests and pushes to `master`:

- Linux: syntax/completeness of Tcl and Tcl modules (without executing them), Python compilation, Bash parsing, XML parsing of `config/*.xml`, version agreement among `hammerdb`, `hammerdbcli` and `hammerdbws`, and the existing Docker `librarycheck` regression test.
- Windows: portable Python, XML, and version checks. This is **not** a Windows build or native runtime test.
- Validator regression tests ensure mismatched version numbers fail the gate.

No database credentials, external test databases, Docker registry write permissions or release tokens are used by the automatic jobs. For branch protection, require **Source checks (Linux)** and **Portable source checks (Windows)** before merging; configure this in GitHub branch rules separately.

To run local checks from the repository root on Linux (requires `python3`, `tclsh`, and `bash`):

```sh
python3 -B ci/check_source.py
python3 -B -m unittest discover -s ci -p 'test_*.py' -v
bash Docker/tests/test-librarycheck-pattern.sh
```

## Manual release-candidate checks

From **Actions → HammerDB pre-release CI → Run workflow**, select the commit/branch to evaluate, enter the expected release version (e.g. `6.1.2`, without the leading `v`), and set **full_linux_build** to `true`.

The extra job builds native Linux x64 dependencies from source using the existing Bawt toolchain, extracts the resulting *development* tarball, verifies CLI startup/command registration/database catalogue, and connects with Pgtcl to a disposable PostgreSQL 17 service for `SELECT 1`. It emits a checksum and a brief test summary as GitHub Actions artifacts, **not** a GitHub release or a pushed Docker image. Build output logs remain on the ephemeral runner and are not uploaded.

The Bawt build depends on the existing external `hammerdb.com/build5` dependency archive endpoint. This job is explicitly manual because it is resource-intensive and downloads upstream components. It should be exercised and debugged on a GitHub-hosted runner before being promoted to a required release check; the workflow was authored without executing a remote runner build.

## Release checklist and remaining coverage

1. Run the automatic checks and resolve failures; review the code as normal.
2. Run the manual full Linux source-build/CLI/PostgreSQL check against the intended release commit and version. Verify the SHA-256 and test summary.
3. Perform native **Windows x64** packaging/runtime testing and cross-database **TPROC-C/TPROC-H** integration benchmarks in controlled test environments (Oracle, SQL Server, Db2, MySQL, MariaDB, PostgreSQL, VillageSQL). Those are **not** covered by this initial workflow.
4. Run the existing release-specific Docker **build-only** multi-architecture smoke checks with verified archive checksums, using the applicable `docker-*-multiarch.yml` workflow. No push or production promotion is performed by this CI.
5. Obtain the required TPC release approvals before publishing. Docker `push-test` and `promote-production` remain independent, explicitly gated actions.

This pipeline checks correctness and packaging, not performance regressions. An objective performance gate needs dedicated persistent database hosts, pinned schemas/hardware and a benchmark baseline; hosted CI timings would not be comparable.
