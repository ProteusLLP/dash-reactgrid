"""Restore public positional argument order after Dash regenerates bindings.

Dash's generator sorts properties alphabetically. Existing Python/R callers may
pass parameters positionally; reorder signatures to the original published
order, appending newly generated props. Keep this step in build:backends.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LEGACY_PYTHON = ["id","columns","data","rowIds","rowPageSize","virtualRowCount","virtualDatasetId","virtualRowHeight","virtualWindowSize","virtualViewportHeight","virtualRequest","virtualData","virtualRangeRequest","virtualRangeData","virtualSelection","virtualExportUrl","transmitSparseEdits","editAck","editDatasetId","newRow","lockedCells","readOnly","hiddenColumns","edits","selectedRowIds","stickyLeftColumns","stickyRightColumns","stickyTopRows","stickyBottomRows","enableFillHandle","enableRangeSelection","enableRowSelection","enableColumnSelection","highlights","selectedCell","selectedRange","isExtendable","style","styleHeader","className","disableVirtualScrolling","dropdownMenuPortal","persistence","persistence_type","persisted_props"]
LEGACY_R = ["id","className","columns","data","disableVirtualScrolling","dropdownMenuPortal","edits","editAck","editDatasetId","enableColumnSelection","enableFillHandle","enableRangeSelection","enableRowSelection","hiddenColumns","highlights","isExtendable","lockedCells","newRow","persisted_props","persistence","persistence_type","readOnly","rowIds","rowPageSize","virtualRowCount","virtualDatasetId","virtualRowHeight","virtualWindowSize","virtualViewportHeight","virtualRequest","virtualData","virtualRangeRequest","virtualRangeData","virtualSelection","virtualExportUrl","selectedCell","transmitSparseEdits","selectedRange","selectedRowIds","stickyBottomRows","stickyLeftColumns","stickyRightColumns","stickyTopRows","style","styleHeader"]


def update_python():
    file = ROOT / "dash_reactgrid" / "DashReactGrid.py"
    content = file.read_text(encoding="utf-8")
    pattern = r"(    def __init__\(\n)(.*?)(    \):\n)"
    match = re.search(pattern, content, re.S)
    if not match:
        raise RuntimeError("Could not locate generated Python constructor")
    args = match.group(2).splitlines(keepends=True)
    declarations = {}
    for line in args:
        item = re.match(r"        (\w+):", line)
        if item:
            declarations[item.group(1)] = line
    if not all(name in declarations for name in LEGACY_PYTHON):
        raise RuntimeError("Generated Python wrapper lost a published property")
    reordered = [declarations[name] for name in LEGACY_PYTHON]
    preferred_new = ["virtualClipboardUrl", "virtualFindRequest", "virtualFindData"]
    reordered += [declarations[name] for name in preferred_new
                  if name in declarations and name not in LEGACY_PYTHON]
    reordered += [line for line in args if
                  (item := re.match(r"        (\w+):", line))
                  and item.group(1) not in LEGACY_PYTHON + preferred_new]
    # self and **kwargs are intentionally kept outside the typed arguments.
    reconstructed = "        self,\n" + "".join(reordered) + "        **kwargs\n"
    file.write_text(content[:match.start()] + match.group(1) +
                    reconstructed + match.group(3) + content[match.end():],
                    encoding="utf-8")
    # dash-generate-components may import the newly generated module before
    # this postprocessor runs. Reordering the source changes no file length,
    # so Python's timestamp-and-size .pyc check can otherwise reuse bytecode
    # with the old positional signature in the *same* build/test job.
    for compiled in (file.parent / "__pycache__").glob("DashReactGrid.*.pyc"):
        compiled.unlink()


def update_r():
    file = ROOT / "R" / "dashReactGrid.R"
    content = file.read_text(encoding="utf-8")
    pattern = r"(dashReactGrid <- function\()(.*?)(\) \{)"
    match = re.search(pattern, content, re.S)
    if not match:
        raise RuntimeError("Could not locate generated R signature")
    entries = match.group(2).split(", ")
    declarations = {entry.split("=", 1)[0]: entry for entry in entries}
    if not all(name in declarations for name in LEGACY_R):
        raise RuntimeError("Generated R wrapper lost a published property")
    ordered = [declarations[name] for name in LEGACY_R]
    # Keep the newly introduced request/response pair in API order.
    preferred_new = ["virtualClipboardUrl", "virtualFindRequest", "virtualFindData"]
    ordered += [declarations[name] for name in preferred_new
                if name in declarations and name not in LEGACY_R]
    ordered += [entry for entry in entries if
                entry.split("=", 1)[0] not in LEGACY_R + preferred_new]
    file.write_text(content[:match.start()] + match.group(1) +
                    ", ".join(ordered) + match.group(3) + content[match.end():],
                    encoding="utf-8")
    # Keep the generated R help usage in the exact same order as the actual
    # exported function. Otherwise positional R examples in help are wrong.
    help_file = ROOT / "man" / "dashReactGrid.Rd"
    help_text = help_file.read_text(encoding="utf-8")
    usage_start = help_text.find(r"\usage{")
    usage_end = help_text.find("\n}", usage_start)
    if usage_start < 0 or usage_end < 0:
        raise RuntimeError("Could not locate generated R Rd usage signature")
    lines = []
    line = "dashReactGrid("
    for index, entry in enumerate(ordered):
        token = ("" if index == 0 else ", ") + entry
        if len(line) + len(token) > 72:
            lines.append(line)
            line = "  " + entry
            if index != 0:
                lines[-1] += ","
        else:
            line += token
    lines.append(line + ")")
    replacement = "\n".join(lines)
    help_file.write_text(help_text[:usage_start] +
                         r"\usage{" + "\n" + replacement + "\n}" +
                         help_text[usage_end+2:], encoding="utf-8")


if __name__ == "__main__":
    update_python()
    update_r()
