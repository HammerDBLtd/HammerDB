#!/usr/bin/env python3
"""Offline, dependency-free checks for HammerDB's release source tree.

The checks deliberately do not execute database benchmarks or depend on private
credentials. They make a fast, reproducible pull-request gate; a separate manual
CI job can compile and smoke-test a release candidate.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
ENTRYPOINTS = ("hammerdb", "hammerdbcli", "hammerdbws")
VERSION_PATTERN = re.compile(r'^\s*set\s+hdb_version\s+["{]v([0-9]+\.[0-9]+\.[0-9]+)["}]\s*$', re.MULTILINE)


def version_from_source(source: str) -> str | None:
    match = VERSION_PATTERN.search(source)
    return match.group(1) if match else None


def check_versions(root: Path, errors: list[str]) -> str | None:
    versions: dict[str, str] = {}
    for name in ENTRYPOINTS:
        path = root / name
        try:
            version = version_from_source(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            errors.append(f"{name}: cannot read entrypoint: {exc}")
            continue
        if version is None:
            errors.append(f"{name}: missing 'set hdb_version \"vX.Y.Z\"'")
        else:
            versions[name] = version
    if len(set(versions.values())) > 1:
        errors.append(f"HammerDB entrypoint versions disagree: {versions}")
    version = next(iter(versions.values()), None)
    if version and len(versions) == len(ENTRYPOINTS):
        print(f"PASS: all three entrypoints declare v{version}")
    return version


def check_python(root: Path, errors: list[str]) -> int:
    paths = sorted((root / "scripts" / "python").rglob("*.py"))
    if not paths:
        errors.append("scripts/python: no Python sources found")
    for path in paths:
        try:
            compile(path.read_bytes(), str(path), "exec", dont_inherit=True)
        except (SyntaxError, ValueError, OSError) as exc:
            errors.append(f"{path.relative_to(root)}: Python syntax error: {exc}")
    print(f"Checked Python: {len(paths)} files")
    return len(paths)


def check_xml(root: Path, errors: list[str]) -> int:
    paths = sorted((root / "config").glob("*.xml"))
    if not paths:
        errors.append("config: no XML configurations found")
    for path in paths:
        try:
            ET.parse(path)
        except (ET.ParseError, OSError) as exc:
            errors.append(f"{path.relative_to(root)}: XML error: {exc}")
    print(f"Checked XML: {len(paths)} files")
    return len(paths)


def run_command(args: list[str], errors: list[str], description: str) -> None:
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=False, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"{description}: unable to run: {exc}")
        return
    if result.returncode:
        details = (result.stderr + "\n" + result.stdout).strip()[-3000:]
        errors.append(f"{description}: failed with exit {result.returncode}: {details}")


def check_tcl(root: Path, errors: list[str]) -> int:
    paths = [root / name for name in ENTRYPOINTS]
    paths.append(root / "Build" / "Bawt-2.1.0" / "Bawt.tcl")
    for directory in (root / "src", root / "scripts" / "tcl", root / "modules"):
        paths.extend(directory.rglob("*.tcl"))
        paths.extend(directory.rglob("*.tm"))
    paths.extend((root / "Build" / "Bawt-2.1.0" / "Setup").glob("*.bawt"))
    paths = sorted(set(paths))
    if len(paths) < 20:
        errors.append("unexpectedly few Tcl source files; is the repository complete?")
    # info complete checks Tcl command/brace/quote termination without executing
    # database logic or needing the HammerDB Tcl 9 runtime.
    run_command(["tclsh", str(root / "ci" / "check_tcl.tcl"), *(str(p) for p in paths)], errors, "Tcl source completeness")
    print(f"Checked Tcl: {len(paths)} files")
    return len(paths)


def check_shell(root: Path, errors: list[str]) -> int:
    paths = sorted(root.rglob("*.sh"))
    paths = [p for p in paths if ".git" not in p.parts]
    if not paths:
        errors.append("no shell scripts found")
    for path in paths:
        run_command(["bash", "-n", str(path)], errors, f"{path.relative_to(root)} shell syntax")
    print(f"Checked Bash: {len(paths)} files")
    return len(paths)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable-only", action="store_true", help="Skip checks requiring bash or tclsh (Windows runners)")
    parser.add_argument("--expected-version", help="Require an exact X.Y.Z release version")
    args = parser.parse_args()
    errors: list[str] = []
    version = check_versions(ROOT, errors)
    if args.expected_version and version != args.expected_version.lstrip("v"):
        errors.append(f"expected v{args.expected_version.lstrip('v')} but source declares v{version or 'unknown'}")
    check_python(ROOT, errors)
    check_xml(ROOT, errors)
    if not args.portable_only:
        check_tcl(ROOT, errors)
        check_shell(ROOT, errors)
    if errors:
        print("\n".join("FAIL: " + e for e in errors), file=sys.stderr)
        return 1
    print("PASS: HammerDB source sanity checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
