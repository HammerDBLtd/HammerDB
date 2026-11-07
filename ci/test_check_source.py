"""Small regression tests for the repository pre-release gate itself."""

from pathlib import Path
import tempfile
import unittest

from check_source import check_versions, version_from_source


class CheckSourceTests(unittest.TestCase):
    def test_read_tcl_version(self) -> None:
        self.assertEqual(version_from_source('set hdb_version "v6.1.1"\n'), "6.1.1")
        self.assertIsNone(version_from_source('puts "not a version"\n'))

    def test_entrypoint_version_mismatch_blocks_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("hammerdb", "hammerdbcli", "hammerdbws"):
                version = "6.1.2" if name == "hammerdbws" else "6.1.1"
                (root / name).write_text(f'set hdb_version "v{version}"\n', encoding="utf-8")
            errors: list[str] = []
            check_versions(root, errors)
            self.assertTrue(any("disagree" in error for error in errors))

    def test_matching_versions_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("hammerdb", "hammerdbcli", "hammerdbws"):
                (root / name).write_text('set hdb_version "v7.0.0"\n', encoding="utf-8")
            errors: list[str] = []
            self.assertEqual(check_versions(root, errors), "7.0.0")
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
