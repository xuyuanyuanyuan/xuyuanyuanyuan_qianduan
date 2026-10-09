"""Standalone entry point for the isolated table regression suite."""

import sys
import unittest
from pathlib import Path


def run_verification() -> bool:
    service_dir = Path(__file__).resolve().parent
    suite = unittest.defaultTestLoader.discover(
        str(service_dir / "tests"), pattern="test_table_*.py", top_level_dir=str(service_dir)
    )
    if suite.countTestCases() == 0:
        raise RuntimeError("No table regression tests were discovered.")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    sys.exit(0 if run_verification() else 1)
