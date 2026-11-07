#!/usr/bin/env bash
set -euo pipefail

# Must run from the GitHub checkout root. The Bawt script currently returns
# success even when Bawt itself fails, so we also require a real build artifact.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root/Build/Bawt-2.1.0"
mkdir -p "$root/ci-artifacts"

# The full Bawt build fetches upstream dependencies; it is intentionally run
# only for explicitly requested release-candidate validation, never on PRs.
bash ./Build-Linux.sh x64 Setup/HammerDB-Linux.bawt complete all > "$root/ci-artifacts/bawt.log" 2>&1 || {
  echo 'FAIL: Bawt source build failed (see runner-local ci-artifacts/bawt.log)' >&2
  exit 1
}

archive=$(find "$root/Build/BawtBuild" -type f -name 'HammerDB-*-Dev-Linux.tar.gz' -print -quit)
[[ -n "$archive" ]] || { echo 'FAIL: Bawt returned without producing a development archive' >&2; exit 1; }

# Keep the candidate and build logs on the isolated runner; no image or package
# is published. Only upload an SHA-256 and the smoke-result text as evidence.
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
tar -xzf "$archive" -C "$tmpdir"
cli=$(find "$tmpdir" -maxdepth 2 -type f -name hammerdbcli -print -quit)
[[ -n "$cli" ]] || { echo 'FAIL: release candidate does not contain hammerdbcli' >&2; exit 1; }
cd "$(dirname "$cli")"
[[ -x ./bin/tclsh9.0 ]] || { echo 'FAIL: compiled Tcl 9 CLI runtime missing' >&2; exit 1; }
chmod +x ./hammerdbcli

export TMP="$tmpdir/tmp"
mkdir -p "$TMP"
export PGPASSWORD=postgres
# Full CLI startup validates native modules; both checks use the built source,
# not published release Docker images.
timeout 90 ./hammerdbcli auto "$root/ci/smoke_cli.tcl" > "$root/ci-artifacts/cli.log" 2>&1 || {
  echo 'FAIL: CLI initialization smoke test failed (see runner-local log)' >&2
  exit 1
}
grep -q '^HAMMERDB_CI_CLI_PASS ' "$root/ci-artifacts/cli.log" || {
  echo 'FAIL: missing CLI success marker' >&2
  exit 1
}

timeout 90 ./hammerdbcli auto "$root/ci/smoke_postgres.tcl" > "$root/ci-artifacts/postgres.log" 2>&1 || {
  echo 'FAIL: PostgreSQL connectivity smoke test failed (see runner-local log)' >&2
  exit 1
}
grep -qx 'HAMMERDB_CI_POSTGRES_PASS' "$root/ci-artifacts/postgres.log" || {
  echo 'FAIL: missing PostgreSQL success marker' >&2
  exit 1
}

sha256sum "$archive" | sed "s|$archive|$(basename "$archive")|" > "$root/ci-artifacts/candidate.sha256"
printf 'CLI initialization: PASS\nPostgreSQL connectivity: PASS\n' > "$root/ci-artifacts/test-summary.txt"
cat "$root/ci-artifacts/test-summary.txt"
