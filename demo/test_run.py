"""Process lifecycle regressions without signalling real processes."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import run


class ProcessIdentityTests(unittest.TestCase):
    def active_with(self, process):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "demo").mkdir()
            (root / "demo/node.pid").write_text("123")
            with patch.object(run, "ROOT", root), patch.object(
                run.subprocess, "run", return_value=SimpleNamespace(stdout=process)
            ):
                return run.active("node", "/expected/psinode")

    def test_exited_and_zombie_children_allow_restart(self):
        for process in ("", "Z (psinode)", "Zs [psinode] <defunct>"):
            with self.subTest(process=process):
                self.assertIsNone(self.active_with(process))

    def test_live_expected_process_is_recognized(self):
        self.assertEqual(self.active_with("Ss /expected/psinode /chain"), 123)

    def test_live_reused_pid_is_never_treated_as_our_process(self):
        with self.assertRaisesRegex(RuntimeError, "Refusing stale node PID"):
            self.active_with("S /unrelated/program")


if __name__ == "__main__":
    unittest.main()
