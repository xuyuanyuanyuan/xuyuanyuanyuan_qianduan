import duckdb
import pandas as pd

from config import settings
from tests.table_support import TableTestCase


class IngestorTests(TableTestCase):
    def test_utf8_aggregation_and_profiles(self):
        dataset = self.ingest_csv(pd.DataFrame({
            "桩号": ["P-001", "P-002", "P-003", "P-004", "P-005"],
            "实际打入深度(m)": [25.4, 24.8, 28.2, 27.9, 30.5],
            "总锤击数(击)": [1420, 1380, 1650, 1590, 1820],
            "施工班组": ["一队", "一队", "二队", "二队", "一队"],
        }))
        sheet = dataset["sheets"][0]
        depth = sheet["columns"][1]
        self.assertEqual((depth["source_name"], depth["sql_name"], depth["business_role"], depth["unit"]),
                         ("实际打入深度(m)", "col_2", "深度", "m"))
        self.assertAlmostEqual(depth["numeric_mean"], 27.36)
        table = sheet["table_name"]
        result = self.engine.run_select(f'SELECT AVG(col_2) AS avg_depth FROM "{table}"')
        self.assertAlmostEqual(result["rows"][0]["avg_depth"], 27.36)
        grouped = self.engine.run_select(
            f'SELECT col_4 AS team, COUNT(*) AS n, AVG(col_3) AS hammers FROM "{table}" GROUP BY col_4'
        )
        rows = {r["team"]: r for r in grouped["rows"]}
        self.assertEqual({k: v["n"] for k, v in rows.items()}, {"一队": 3, "二队": 2})
        self.assertAlmostEqual(rows["一队"]["hammers"], 1540)
        self.assertAlmostEqual(rows["二队"]["hammers"], 1620)

    def test_multisheet_and_project_roundtrip(self):
        path = self.root / "工程.XLSX"
        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            pd.DataFrame({"桩号": ["A", "B"], "深度": [11, 12]}).to_excel(writer, sheet_name="一标段", index=False)
            pd.DataFrame({"编号": ["C"], "备注": ["正常"]}).to_excel(writer, sheet_name="二标段", index=False)
        dataset = self.ingestor.ingest(path, path.name, description="  手工说明  ", project_name="测试项目")
        saved = self.registry.get(dataset["dataset_id"])
        self.assertEqual(saved["sheet_count"], 2)
        self.assertEqual(saved["total_rows"], 3)
        self.assertEqual(saved["project_name"], "测试项目")
        self.assertEqual(saved["description"], "手工说明")
        self.assertEqual(saved["raw_description"], "  手工说明  ")
        self.assertEqual(saved["sheets"], dataset["sheets"])
        self.assertEqual([s["sheet_name"] for s in saved["sheets"]], ["一标段", "二标段"])
        self.assertEqual(len({s["table_name"] for s in saved["sheets"]}), 2)
        for sheet, first in zip(saved["sheets"], ["A", "C"]):
            self.assertEqual(self.engine.preview_table(sheet["table_name"])["rows"][0]["col_1"], first)

    def test_gbk_csv(self):
        dataset = self.ingest_csv(encoding="gbk", name="施工.CSV", project_name="中文工程")
        sheet = dataset["sheets"][0]
        self.assertEqual(sheet["columns"][0]["source_name"], "桩号")
        self.assertEqual(self.engine.preview_table(sheet["table_name"])["rows"][0]["col_1"], "P-001")

    def test_empty_and_constant_columns_and_json_null(self):
        dataset = self.ingest_csv(pd.DataFrame({"桩号": ["A", "B"], "空列": [None, None], "固定": ["一队", "一队"]}))
        sheet = dataset["sheets"][0]
        empty, constant = sheet["columns"][1:]
        self.assertEqual(empty["quality_flags"], ["全空列"])
        self.assertEqual((empty["null_count"], empty["non_null_count"], empty["sample_values"]), (2, 0, []))
        self.assertIsNone(empty["numeric_mean"])
        self.assertEqual(constant["quality_flags"], ["单值列"])
        self.assertEqual(dataset["quality_report"], {"total_sheets": 1, "total_columns": 3, "empty_columns": 1, "has_warnings": True})
        self.assertIsNone(self.engine.preview_table(sheet["table_name"])["rows"][0]["col_2"])

    def test_generated_description_and_header_only_csv(self):
        dataset = self.ingest_csv(pd.DataFrame(columns=["编号", "备注"]), project_name="空表项目")
        saved = self.registry.get(dataset["dataset_id"])
        self.assertIn("空表项目", saved["description"])
        self.assertEqual(saved["total_rows"], 0)
        self.assertEqual(self.engine.preview_table(saved["sheets"][0]["table_name"])["rows"], [])

    def test_invalid_files_do_not_register_datasets(self):
        cases = [("bad.txt", b"hello", ValueError), ("empty.csv", b"", pd.errors.EmptyDataError),
                 ("bad.xlsx", b"not a workbook", ValueError), ("missing.csv", None, FileNotFoundError)]
        for filename, content, error in cases:
            with self.subTest(filename=filename):
                path = self.root / filename
                if content is not None:
                    path.write_bytes(content)
                with self.assertRaises(error):
                    self.ingestor.ingest(path, filename)
                self.assertEqual(self.registry.count(), 0)

    def test_delete_removes_all_sheets_and_is_idempotent(self):
        path = self.root / "two.xlsx"
        with pd.ExcelWriter(path) as writer:
            for name in ["A", "B"]:
                pd.DataFrame({"x": [1]}).to_excel(writer, sheet_name=name, index=False)
        dataset = self.ingestor.ingest(path, path.name)
        self.assertTrue(self.ingestor.delete_dataset(dataset["dataset_id"]))
        self.assertIsNone(self.registry.get(dataset["dataset_id"]))
        self.assertFalse(self.ingestor.delete_dataset(dataset["dataset_id"]))
        with duckdb.connect(str(settings.warehouse_db)) as conn:
            self.assertEqual(conn.execute("SHOW TABLES").fetchall(), [])

    def test_later_invalid_sheet_rolls_back_the_workbook(self):
        path = self.root / "partial.xlsx"
        with pd.ExcelWriter(path) as writer:
            pd.DataFrame({"id": [1]}).to_excel(writer, sheet_name="valid", index=False)
            pd.DataFrame().to_excel(writer, sheet_name="no-columns", index=False)
        with self.assertRaises(duckdb.Error):
            self.ingestor.ingest(path, path.name)
        self.assertEqual(self.registry.count(), 0)
        with duckdb.connect(str(settings.warehouse_db)) as conn:
            self.assertEqual(conn.execute("SHOW TABLES").fetchall(), [])
