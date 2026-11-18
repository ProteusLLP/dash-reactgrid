#!/usr/bin/env python3
"""Measure unit-source coverage and Chrome suite execution in GitHub Actions.

Browser suites are real integration tests, but their completion is NOT a
percentage of source statements/branches executed in a browser.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

# Keep the suite inventory explicit: missing/skipped suites remain visible.
BROWSER_SUITES = {
    "tests/test_feature_matrix_browser.py": "Cell types, keyboard and clipboard",
    "tests/test_sparse_browser.py": "Sparse edits, acknowledgements and reload",
    "tests/test_server_virtual_browser.py": "Server scrolling and offscreen Find",
    "tests/test_virtual_operations_browser.py": "Virtual selection, fill, undo and redo",
    "tests/test_virtual_reliable_browser.py": "Virtual edits and durable replay",
    "tests/test_client_virtual_browser.py": "Client memory virtualisation",
    "tests/test_large_in_memory_browser.py": "Large in-memory fill and undo",
    "tests/test_large_virtual_clipboard_browser.py": "Large virtual clipboard and selection",
}
REPORT_DIR = Path("coverage-reports")


def node_coverage(path: Path):
    """Return coverage of Node-imported modules, or None if unavailable."""
    if not path.is_file():
        return None
    match = re.search(
        r"^\s*#\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|",
        path.read_text(encoding="utf-8", errors="replace"), flags=re.MULTILINE,
    )
    if not match:
        return None
    return dict(zip(("line_percent", "branch_percent", "function_percent"),
                    (float(x) for x in match.groups())))


def python_coverage(path: Path):
    """Read overall coverage.py XML metrics (branch and line rates are distinct)."""
    if not path.is_file():
        return None
    try:
        root = ET.parse(path).getroot()
        return {
            "line_percent": round(float(root.attrib["line-rate"]) * 100, 2),
            "branch_percent": round(float(root.attrib["branch-rate"]) * 100, 2),
            "lines_covered": int(root.attrib["lines-covered"]),
            "lines_valid": int(root.attrib["lines-valid"]),
        }
    except (ET.ParseError, ValueError, KeyError):
        return None


def browser_result_path(script: str, root: Path = REPORT_DIR) -> Path:
    return root / "browser" / (Path(script).stem + ".json")


def run_browser(script: str, root: Path = REPORT_DIR) -> int:
    if script not in BROWSER_SUITES:
        raise ValueError("Unregistered browser suite: " + script)
    start = time.monotonic()
    code = 1
    error = None
    try:
        code = subprocess.run([sys.executable, script], check=False).returncode
    except OSError as exc:
        error = str(exc)
    record = {
        "script": script,
        "focus": BROWSER_SUITES[script],
        "status": "passed" if code == 0 else "failed",
        "exit_code": code,
        "elapsed_seconds": round(time.monotonic() - start, 2),
    }
    if error:
        record["error"] = error
    output = browser_result_path(script, root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return 0 if code == 0 else 1


def browser_results(root: Path = REPORT_DIR):
    results = []
    for script, focus in BROWSER_SUITES.items():
        path = browser_result_path(script, root)
        record = {"script": script, "focus": focus, "status": "not run"}
        if path.is_file():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                if saved.get("script") == script and saved.get("status") in ("passed", "failed"):
                    record = {**record, **saved}
                else:
                    record["status"] = "invalid report"
            except (ValueError, OSError):
                record["status"] = "invalid report"
        results.append(record)
    return results


def collect_summary(root: Path = REPORT_DIR):
    browser = browser_results(root)
    return {
        "commit": os.environ.get("GITHUB_SHA", ""),
        "collected_at_utc": datetime.now(timezone.utc).isoformat(),
        "javascript_node_modules": node_coverage(Path("js-coverage.txt")),
        "python_unit": python_coverage(Path("python-coverage.xml")),
        "browser_suites": browser,
        "browser_suites_passed": sum(r["status"] == "passed" for r in browser),
        "browser_suites_configured": len(browser),
    }


def markdown_summary(summary):
    js, py = summary["javascript_node_modules"], summary["python_unit"]
    lines = ["## Dash ReactGrid coverage", "",
             "| Measurement | Line coverage | Branch coverage | Other |",
             "| --- | ---: | ---: | --- |"]
    if js:
        lines.append(
            f"| JavaScript imported Node modules | {js['line_percent']:.2f}% | "
            f"{js['branch_percent']:.2f}% | Functions {js['function_percent']:.2f}% |"
        )
    else:
        lines.append("| JavaScript imported Node modules | Not available | Not available | |")
    if py:
        lines.append(
            f"| Python unit-tested package | {py['line_percent']:.2f}% | "
            f"{py['branch_percent']:.2f}% | {py['lines_covered']}/{py['lines_valid']} lines |"
        )
    else:
        lines.append("| Python unit-tested package | Not available | Not available | |")
    lines.extend(["", "### Chrome suite execution",
                  f"{summary['browser_suites_passed']} of "
                  f"{summary['browser_suites_configured']} configured suites passed.",
                  "", "| Browser suite | Scenario group | Outcome |",
                  "| --- | --- | --- |"])
    for case in summary["browser_suites"]:
        lines.append(
            f"| {Path(case['script']).name} | {case['focus']} | {case['status']} |"
        )
    lines.extend(["",
        "Node metrics count only modules loaded by Node unit tests; they do not "
        "measure React component/browser code.",
        "Chrome figures indicate which scripted suites completed successfully. "
        "They are not browser JavaScript line/branch coverage or a guarantee that "
        "all behaviours in each scenario group were tested.",
        "No coverage thresholds are enforced. See the published raw reports "
        "and JSON artifact for historical comparisons.", ""])
    return "\n".join(lines)


def write_summary(root: Path = REPORT_DIR):
    summary = collect_summary(root)
    text = markdown_summary(summary)
    root.mkdir(parents=True, exist_ok=True)
    (root / "coverage-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (root / "coverage-summary.md").write_text(text, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(text + "\n")
    print(text)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("browser")
    run.add_argument("script", choices=list(BROWSER_SUITES))
    subparsers.add_parser("summary")
    args = parser.parse_args()
    if args.command == "browser":
        return run_browser(args.script)
    write_summary()
    return 0


if __name__ == "__main__":
    sys.exit(main())
