import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import verify_table_pipeline


class EntrypointTests(unittest.TestCase):
    def test_failure_and_success_are_reported_without_bare_asserts(self):
        for success in [False, True]:
            with self.subTest(success=success):
                case = unittest.FunctionTestCase(lambda: None if success else self.fail("injected regression"))
                with patch.object(unittest.defaultTestLoader, "discover", return_value=unittest.TestSuite([case])):
                    with contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(verify_table_pipeline.run_verification(), success)

    def test_zero_tests_fails_closed(self):
        with patch.object(unittest.defaultTestLoader, "discover", return_value=unittest.TestSuite()):
            with self.assertRaisesRegex(RuntimeError, "No table"):
                verify_table_pipeline.run_verification()

    def test_script_exit_status_from_arbitrary_cwd(self):
        # Inject a tiny suite, then execute the actual __main__ path in a child
        # process to verify nonzero exit status without recursively running tests.
        script = Path(verify_table_pipeline.__file__).resolve()
        for success in [False, True]:
            with self.subTest(success=success), tempfile.TemporaryDirectory() as cwd:
                source = (
                    "import runpy, unittest\n"
                    "def check():\n"
                    + ("    pass\n" if success else "    raise AssertionError('injected failure')\n")
                    + "unittest.defaultTestLoader.discover = lambda *a, **k: unittest.TestSuite([unittest.FunctionTestCase(check)])\n"
                    + f"runpy.run_path({str(script)!r}, run_name='__main__')\n"
                )
                result = subprocess.run([sys.executable, "-O", "-c", source], cwd=cwd,
                                        capture_output=True, text=True, env=os.environ.copy(), timeout=20)
                self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
