"""Tests for coverage extraction and honest browser-suite reporting."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.coverage_measure import (
    BROWSER_SUITES, browser_result_path, browser_results,
    collect_summary, markdown_summary, node_coverage, python_coverage,
    run_browser, write_summary,
)


class CoverageMeasurementTests(unittest.TestCase):
    def test_node_report_uses_total_row_and_missing_report_is_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "node.txt"
            self.assertIsNone(node_coverage(path))
            path.write_text(
                "# file | line % | branch % | funcs % | uncovered lines\n"
                "# lib/a.js | 0.00 | 0.00 | 0.00 |\n"
                "# all files | 90.83 | 89.21 | 95.98 |\n",
                encoding="utf-8",
            )
            self.assertEqual(node_coverage(path), {
                "line_percent": 90.83,
                "branch_percent": 89.21,
                "function_percent": 95.98,
            })

    def test_python_xml_reports_line_and_branch_separately(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "python.xml"
            self.assertIsNone(python_coverage(path))
            path.write_text(
                '<coverage line-rate="0.75" branch-rate="0.50" '
                'lines-covered="75" lines-valid="100" />', encoding="utf-8",
            )
            self.assertEqual(python_coverage(path), {
                "line_percent": 75.0, "branch_percent": 50.0,
                "lines_covered": 75, "lines_valid": 100,
            })
            path.write_text("<invalid>", encoding="utf-8")
            self.assertIsNone(python_coverage(path))

    def test_browser_runner_propagates_exit_status_and_records_result(self):
        script = next(iter(BROWSER_SUITES))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch("scripts.coverage_measure.subprocess.run",
                       return_value=subprocess.CompletedProcess([], 0)) as run:
                self.assertEqual(run_browser(script, root), 0)
                run.assert_called_once_with(
                    [sys.executable, script], check=False)
            saved = json.loads(browser_result_path(script, root).read_text())
            self.assertEqual(saved["status"], "passed")
            with patch("scripts.coverage_measure.subprocess.run",
                       return_value=subprocess.CompletedProcess([], 3)):
                self.assertEqual(run_browser(script, root), 1)
            saved = json.loads(browser_result_path(script, root).read_text())
            self.assertEqual(saved["status"], "failed")
            self.assertEqual(saved["exit_code"], 3)

    def test_missing_and_invalid_browser_reports_are_never_passed(self):
        script = next(iter(BROWSER_SUITES))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cases = browser_results(root)
            self.assertEqual(len(cases), len(BROWSER_SUITES))
            self.assertTrue(all(x["status"] == "not run" for x in cases))
            dest = browser_result_path(script, root)
            dest.parent.mkdir(parents=True)
            dest.write_text('{"script": "not_this_suite", "status": "passed"}')
            self.assertEqual(browser_results(root)[0]["status"], "invalid report")
            dest.write_text("{broken")
            self.assertEqual(browser_results(root)[0]["status"], "invalid report")

    def test_summary_writes_machine_readable_and_markdown_without_inventing_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path.cwd()
            try:
                os.chdir(folder)
                root = Path("reports")
                cases = list(BROWSER_SUITES)
                dest = browser_result_path(cases[0], root)
                dest.parent.mkdir(parents=True)
                dest.write_text(json.dumps({
                    "script": cases[0], "status": "passed",
                    "focus": BROWSER_SUITES[cases[0]],
                }))
                with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}):
                    summary = write_summary(root)
                self.assertIsNone(summary["python_unit"])
                self.assertIsNone(summary["javascript_node_modules"])
                self.assertEqual(summary["browser_suites_passed"], 1)
                self.assertEqual(summary["browser_suites_configured"], len(cases))
                md = (root / "coverage-summary.md").read_text()
                self.assertIn("1 of 8 configured suites passed", md)
                self.assertIn("Not available", md)
                self.assertIn("not browser JavaScript line/branch coverage", md)
                self.assertEqual(
                    json.loads((root / "coverage-summary.json").read_text())[
                        "browser_suites_passed"], 1)
            finally:
                os.chdir(original)

    def test_refuses_unregistered_browser_script(self):
        with self.assertRaises(ValueError):
            run_browser("tests/test_unknown.py")


if __name__ == "__main__":
    unittest.main()
