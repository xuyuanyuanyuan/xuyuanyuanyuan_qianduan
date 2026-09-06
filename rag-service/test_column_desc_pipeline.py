import sys
import tempfile
from pathlib import Path
import pandas as pd

service_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(service_dir))

from tables.ingestor import TableIngestor
from tables.registry import TableRegistry
from tables.query_engine import QueryEngine


def run_test():
    print("=== Testing Column Description Update & Sample Rows Pipeline ===")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_file = tmp_path / "test_pile_desc.csv"

        df = pd.DataFrame(
            {
                "桩号": ["PHC-001", "PHC-002", "PHC-003", "PHC-004", "PHC-005"],
                "设计桩长": [28.0, 28.0, 30.0, 30.0, 32.0],
                "实际打入深度": [28.4, 28.1, 27.5, 30.2, 32.0],
                "贯入度": [18.2, 19.0, 10.5, 12.0, 15.0],
            }
        )
        df.to_csv(csv_file, index=False, encoding="utf-8")

        registry = TableRegistry()
        ingestor = TableIngestor(registry)
        dataset = ingestor.ingest(
            file_path=csv_file,
            original_filename="test_pile_desc.csv",
            description="初始测试工程背景",
        )
        dataset_id = dataset["dataset_id"]
        sheet_id = dataset["sheets"][0]["sheet_id"]
        table_name = dataset["sheets"][0]["table_name"]

        # 1. Verify default description in columns
        first_col = dataset["sheets"][0]["columns"][0]
        assert "description" in first_col, "Column profile missing description field"
        print("1. Ingest profile verified with description field:", first_col.get("description", ""))

        # 2. Test updating column descriptions
        updates = [
            {
                "sql_name": "col_1",
                "business_role": "桩号",
                "unit": "无",
                "description": "工程预制桩唯一编号标识",
            },
            {
                "sql_name": "col_3",
                "business_role": "实际打入深度",
                "unit": "m",
                "description": "桩尖实际进入土层深度，单位米",
            },
        ]
        updated = registry.update_column_descriptions(
            dataset_id=dataset_id,
            sheet_id=sheet_id,
            column_updates=updates,
            general_description="更新后的打桩施工沉桩质量记录表",
        )
        assert updated is not None, "Failed to update column descriptions"
        assert updated["description"] == "更新后的打桩施工沉桩质量记录表"

        col_map = {c["sql_name"]: c for c in updated["sheets"][0]["columns"]}
        assert col_map["col_1"]["description"] == "工程预制桩唯一编号标识"
        assert col_map["col_3"]["unit"] == "m"
        assert col_map["col_3"]["description"] == "桩尖实际进入土层深度，单位米"
        print("2. Column description update verified:", col_map["col_1"]["description"])

        # 3. Test Preview / Sample Rows
        engine = QueryEngine()
        sample_res = engine.preview_table(table_name, limit=3)
        assert len(sample_res["rows"]) == 3
        print("3. Sample rows preview verified (3 rows returned):", sample_res["rows"][0])

        # Cleanup
        ingestor.delete_dataset(dataset_id)
        print("4. Cleaned up test dataset.")

    print("=== [PASS] Column descriptions & sample rows pipeline test passed! ===")


if __name__ == "__main__":
    run_test()

