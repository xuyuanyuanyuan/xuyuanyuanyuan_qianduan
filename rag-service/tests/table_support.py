"""Real SQLite/DuckDB fixtures; all files live in a per-test temporary directory."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from config import settings
from tables import QueryEngine, TableIngestor, TableRegistry


class TableTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="table-regression-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for field, value in {
            "table_data_dir": self.root / "data",
            "table_upload_dir": self.root / "uploads",
            "warehouse_db": self.root / "data" / "warehouse.duckdb",
            "table_registry_db": self.root / "data" / "registry.sqlite3",
        }.items():
            patcher = patch.object(settings, field, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.registry = TableRegistry()
        self.ingestor = TableIngestor(self.registry)
        self.engine = QueryEngine(settings.warehouse_db, registry=self.registry)

    def ingest_csv(self, frame=None, name="records.csv", **kwargs):
        if frame is None:
            frame = pd.DataFrame({"桩号": ["P-001", "P-002", "P-003"], "深度(m)": [10, 20, 30]})
        path = self.root / name
        frame.to_csv(path, index=False, encoding=kwargs.pop("encoding", "utf-8"))
        return self.ingestor.ingest(path, original_filename=name, **kwargs)
