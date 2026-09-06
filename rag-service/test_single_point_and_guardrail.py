import sys
import tempfile
from pathlib import Path
import pandas as pd

service_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(service_dir))

from tables.ingestor import TableIngestor
from tables.query_engine import QueryEngine
from tables.registry import TableRegistry


def run_test():
    print("=== Testing Single-Point Query & Zero-Row Guardrail in DuckDB ===")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_file = tmp_path / "sample_piles.csv"

        df = pd.DataFrame(
            {
                "桩号": ["PHC-001", "PHC-002", "PHC-007"],
                "设计桩长(m)": [28.0, 28.0, 30.0],
                "实际打入深度(m)": [28.4, 28.1, 27.5],
                "总锤击数(击)": [1450, 1380, 1950],
                "停锤贯入度(mm/10击)": [18.2, 19.0, 10.5],
            }
        )
        df.to_csv(csv_file, index=False, encoding="utf-8")

        registry = TableRegistry()
        ingestor = TableIngestor(registry)
        dataset = ingestor.ingest(
            file_path=csv_file,
            original_filename="sample_piles.csv",
        )
        dataset_id = dataset["dataset_id"]
        table_name = dataset["sheets"][0]["table_name"]

        query_engine = QueryEngine()

        # 1. Test Single-Point Query: Matching existing pile with fuzzy/upper/replace
        sql_match = f"""
        SELECT col_1 as pile_id, col_2 as design_len, col_3 as actual_depth, col_5 as penetration
        FROM "{table_name}"
        WHERE UPPER(REPLACE(CAST(col_1 AS VARCHAR), '-', '')) LIKE '%PHC007%'
        """
        res_match = query_engine.run_select(sql_match)
        print("1. Matching existing pile (PHC-007):", res_match["rows"])
        assert len(res_match["rows"]) == 1
        assert float(res_match["rows"][0]["actual_depth"]) == 27.5
        print("   -> Exact depth 27.5m matched without hallucination!")

        # 2. Test Non-existent Single-Point Query: Searching for "A1" or "A999"
        sql_no_match = f"""
        SELECT col_1 as pile_id, col_3 as actual_depth
        FROM "{table_name}"
        WHERE UPPER(CAST(col_1 AS VARCHAR)) LIKE '%A1%'
        """
        res_no_match = query_engine.run_select(sql_no_match)
        print("2. Searching non-existent pile (A1):", res_no_match["rows"])
        assert len(res_no_match["rows"]) == 0
        assert res_no_match["row_count"] == 0
        print("   -> 0 rows returned as expected.")

        # 3. Test Distinct Pile Samples for Zero-Row Guardrail
        sql_distinct = f"""
        SELECT DISTINCT col_1 FROM "{table_name}" WHERE col_1 IS NOT NULL LIMIT 8
        """
        res_distinct = query_engine.run_select(sql_distinct)
        sample_piles = [r["col_1"] for r in res_distinct["rows"]]
        print("3. Distinct pile samples extracted for Guardrail prompt:", sample_piles)
        assert "PHC-001" in sample_piles
        assert "PHC-007" in sample_piles

        # Cleanup
        ingestor.delete_dataset(dataset_id)
        print("4. Cleaned up test dataset.")

    print("=== [PASS] Single-point query and zero-row guardrail test passed! ===")


if __name__ == "__main__":
    run_test()
