"""End-to-end tests for safe generated-file-only rebases."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rebase_generated.py"


class GeneratedRebaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Rebase Test")
        self.git("config", "user.email", "test@example.test")
        (self.repo / "R").mkdir()
        (self.repo / "R" / "dashReactGrid.R").write_text("generated base\n")
        (self.repo / "source.txt").write_text("original source\n")
        self.commit("base")
        self.git("branch", "feature")
        self.builder = self.root / "mock_builder.py"
        self.builder.write_text(
            "from pathlib import Path\n"
            "root=Path.cwd()\n"
            "(root/'R'/'dashReactGrid.R').write_text('rebuilt: '+"
            "(root/'source.txt').read_text())\n"
        )

    def git(self, *args, check=True):
        return subprocess.run(
            ["git", *args], cwd=self.repo, check=check, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-m", message)

    def rebase(self):
        env = {**os.environ, "REBASE_GENERATED_BUILD_COMMAND":
               f"{sys.executable} {self.builder}"}
        return subprocess.run(
            [sys.executable, str(SCRIPT), "main"],
            cwd=self.repo, env=env, capture_output=True, text=True,
        )

    def test_generated_conflict_uses_main_temporarily_then_rebuilds(self):
        (self.repo / "R" / "dashReactGrid.R").write_text("main asset\n")
        self.commit("main generated changes")
        main = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("checkout", "feature")
        (self.repo / "source.txt").write_text("feature source\n")
        (self.repo / "R" / "dashReactGrid.R").write_text("feature asset\n")
        self.commit("feature source and generated changes")
        result = self.rebase()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.git("merge-base", "--is-ancestor", main, "HEAD")
        self.assertEqual((self.repo / "R" / "dashReactGrid.R").read_text(),
                         "rebuilt: feature source\n")
        self.assertFalse(self.git("status", "--porcelain").stdout.strip())

    def test_handwritten_conflict_stops_without_choosing_a_side(self):
        (self.repo / "source.txt").write_text("main source\n")
        self.commit("main source changes")
        self.git("checkout", "feature")
        (self.repo / "source.txt").write_text("feature source\n")
        self.commit("feature source changes")
        result = self.rebase()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source.txt", result.stderr)
        self.assertIn("<<<<<<<", (self.repo / "source.txt").read_text())
        self.assertFalse((self.repo / "R" / "dashReactGrid.R").read_text().startswith("rebuilt:"))


if __name__ == "__main__":
    unittest.main()
