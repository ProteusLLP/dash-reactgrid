#!/usr/bin/env python3
"""Rebase a feature branch, resolving *only* reproducible generated files.

Run from a clean feature branch after fetching the latest main:
    python scripts/rebase_generated.py origin/main

During a rebase, "ours" is the new base. Generated conflict versions are
discarded temporarily and rebuilt once all source commits have replayed.
Any handwritten-file conflict halts the rebase without silently choosing a
side. This command never pushes; force-with-lease remains a separate action.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import subprocess
import sys

GENERATED = frozenset({
    "R/dashReactGrid.R",
    "dash_reactgrid/DashReactGrid.py",
    "dash_reactgrid/dash_reactgrid.min.js",
    "dash_reactgrid/dash_reactgrid.min.js.map",
    "dash_reactgrid/metadata.json",
    "dash_reactgrid/package-info.json",
    "deps/dash_reactgrid.min.js",
    "deps/dash_reactgrid.min.js.map",
    "inst/deps/dash_reactgrid.min.js",
    "inst/deps/dash_reactgrid.min.js.map",
    "man/dashReactGrid.Rd",
    "src/jl/dashreactgrid.jl",
})


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], check=check)


def git_lines(*args: str) -> list[str]:
    proc = subprocess.run(["git", *args], check=True, stdout=subprocess.PIPE)
    return [part.decode("utf-8") for part in proc.stdout.split(b"\0") if part]


def rebasing() -> bool:
    for state in ("rebase-merge", "rebase-apply"):
        path = subprocess.run(
            ["git", "rev-parse", "--git-path", state],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        if Path(path).exists():
            return True
    return False


def resolve_generated() -> bool:
    conflicts = git_lines("diff", "--name-only", "-z", "--diff-filter=U")
    if not conflicts:
        raise RuntimeError("Rebase halted without unresolved paths; inspect git status")
    manual = sorted(set(conflicts) - GENERATED)
    if manual:
        print("Source conflicts require review; no handwritten files were overwritten:",
              file=sys.stderr)
        for path in manual:
            print("  " + path, file=sys.stderr)
        print("Resolve these conflicts and run git rebase --continue, or "
              "git rebase --abort.", file=sys.stderr)
        return False
    for path in conflicts:
        # Stage 2 is 'ours' while replaying feature commits onto the new base.
        # A missing stage 2 means the target file was deleted upstream.
        unmerged = subprocess.run(
            ["git", "ls-files", "-u", "-z", "--", path],
            check=True, capture_output=True,
        ).stdout
        has_ours = any(
            entry.split(b"\t", 1)[0].endswith(b" 2")
            for entry in unmerged.split(b"\0") if entry
        )
        if has_ours:
            git("checkout", "--ours", "--", path)
            git("add", "--", path)
        else:
            git("rm", "--ignore-unmatch", "--", path)
        print("Deferred generated-file conflict:", path)
    return True


def assert_clean() -> None:
    state = subprocess.run(
        ["git", "status", "--porcelain", "-z"],
        check=True, capture_output=True,
    ).stdout
    if state:
        raise RuntimeError("Working tree must be clean before rebasing")
    branch = subprocess.run(
        ["git", "symbolic-ref", "--short", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    if branch in ("main", "master", "dev"):
        raise RuntimeError("Refusing to rebase a shared base branch")


def build_generated() -> None:
    # Override only in isolated unit tests. Production always runs npm build.
    build = shlex.split(os.environ.get("REBASE_GENERATED_BUILD_COMMAND",
                                      "npm run build"))
    if not build:
        raise RuntimeError("Build command must not be empty")
    subprocess.run(build, check=True)
    changed = set(git_lines("diff", "--name-only", "-z"))
    untracked = set(git_lines("ls-files", "--others", "--exclude-standard", "-z"))
    unexpected = sorted((changed | untracked) - GENERATED)
    if unexpected:
        raise RuntimeError("Build touched non-generated files: " + ", ".join(unexpected))
    git("add", "-A", "--", *sorted(GENERATED))
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode:
        git("commit", "-m", "build: regenerate bindings and assets after rebase")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("upstream", nargs="?", default="origin/main")
    options = parser.parse_args()
    try:
        assert_clean()
        proc = git("rebase", "--merge", options.upstream, check=False)
        while proc.returncode:
            if not rebasing() or not resolve_generated():
                return 1
            proc = git("-c", "core.editor=true", "rebase", "--continue",
                       check=False)
        build_generated()
        print("Rebased successfully. Run tests, then push with --force-with-lease.")
        return 0
    except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
        print("Generated-file rebase failed:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
