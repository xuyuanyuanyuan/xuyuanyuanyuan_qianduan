import sys
import tempfile
from pathlib import Path
import pandas as pd

service_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(service_dir))

from tables.ingestor import TableIngestor
from tables.query_engine import QueryEngine
from tables.registry import TableRegistry


def run_verification():
    print("=== Start verifying table computation and ingestion engine ===")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_file = tmp_path / "pile_records_test.csv"

        df = pd.DataFrame(
            {
                "桩号": ["P-001", "P-002", "P-003", "P-004", "P-005"],
                "施工日期": ["2026-05-01", "2026-05-01", "2026-05-02", "2026-05-02", "2026-05-03"],
                "设计桩长(m)": [25.0, 25.0, 28.0, 28.0, 30.0],
                "实际打入深度(m)": [25.4, 24.8, 28.2, 27.9, 30.5],
                "总锤击数(击)": [1420, 1380, 1650, 1590, 1820],
                "停锤贯入度(mm/10击)": [18.5, 19.2, 16.0, 17.5, 15.2],
                "施工班组": ["一队", "一队", "二队", "二队", "一队"],
            }
        )
        df.to_csv(csv_file, index=False, encoding="utf-8")
        print(f"1. Generated synthetic pile records ({len(df)} rows)")

        registry = TableRegistry()
        ingestor = TableIngestor(registry)
        dataset = ingestor.ingest(
            file_path=csv_file,
            original_filename="pile_records_test.csv",
            description="打桩施工记录测试表",
            project_name="测试工程标段",
        )
        dataset_id = dataset["dataset_id"]
        table_name = dataset["sheets"][0]["table_name"]
        print(f"2. Table ingested successfully: dataset_id={dataset_id}, table_name={table_name}")

        columns = dataset["sheets"][0]["columns"]
        print("3. Column profile recognition:")
        for col in columns:
            print(f"   - {col['sql_name']}: {col['source_name']} -> role: {col['business_role']}, unit: {col['unit']}")

        query_engine = QueryEngine()

        sql1 = f"SELECT AVG(CAST(col_4 AS DOUBLE)) as avg_depth FROM {table_name}"
        res1 = query_engine.run_select(sql1)
        avg_depth = res1["rows"][0]["avg_depth"]
        print(f"4. SQL test 1 (avg depth): {avg_depth:.2f} m")
        assert round(avg_depth, 2) == 27.36, f"Expected 27.36, got {avg_depth}"

        sql2 = f"SELECT col_7 as team, COUNT(*) as pile_count, AVG(CAST(col_5 AS DOUBLE)) as avg_hammers FROM {table_name} GROUP BY col_7"
        res2 = query_engine.run_select(sql2)
        print(f"5. SQL test 2 (group by team): {res2['rows']}")
        assert len(res2["rows"]) == 2

        try:
            query_engine.run_select(f"DROP TABLE {table_name}")
            print("Security check failed!")
        except ValueError as err:
            print(f"6. Security check passed: {err}")

        ingestor.delete_dataset(dataset_id)
        print(f"7. Cleaned up test dataset: {dataset_id}")

    print("=== [PASS] All table engine and query verification passed successfully! ===")


if __name__ == "__main__":
    run_verification()

