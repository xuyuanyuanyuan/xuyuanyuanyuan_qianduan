import json

import duckdb
import pandas as pd

from tests.table_support import TableTestCase


class QueryTests(TableTestCase):
    def setUp(self):
        super().setUp()
        self.dataset = self.ingest_csv()
        self.table = self.dataset["sheets"][0]["table_name"]

    def test_comments_case_whitespace_and_model_wrappers(self):
        for sql in ["select 1 AS value", "SeLeCt\n1 AS value", "SELECT\t1 AS value",
                    "\ufeff SELECT 1 AS value;", "-- line\n/* block */ SELECT 1 AS value; -- tail",
                    "/* outer /* nested */ comment */ SELECT 1 AS value",
                    "SELECT /* inline */ 1 AS value -- trailing", "WITH\nq AS (SELECT 1 AS value) SELECT * FROM q",
                    "```SQL\nSELECT 1 AS value;\n```", "`SELECT 1 AS value`", "SQL: SELECT 1 AS value"]:
            with self.subTest(sql=sql):
                self.assertEqual(self.engine.run_select(sql)["rows"], [{"value": 1}])

    def test_literals_and_identifiers_are_not_sql_commands(self):
        sql = "SELECT 'drop; -- update /* */' AS text, 1 AS \"delete\""
        self.assertEqual(self.engine.run_select(sql)["rows"], [{"text": "drop; -- update /* */", "delete": 1}])

    def test_mutations_and_non_select_are_rejected(self):
        for sql in [f'DROP TABLE "{self.table}"', f'dElEtE FROM "{self.table}"',
                    f'UPDATE "{self.table}" SET col_2=0', "CREATE TABLE nope(x INT)",
                    "INSERT INTO nope VALUES (1)", "ATTACH 'other.db' AS other", "PRAGMA version",
                    "COPY (SELECT 1) TO 'out.csv'", "CALL dbgen(sf=1)", "SHOW TABLES",
                    f'WITH q AS (SELECT 1) DELETE FROM "{self.table}"']:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                self.engine.run_select(sql)
        self.assertEqual(self.engine.preview_table(self.table)["row_count"], 3)
        self.assertFalse((self.root / "out.csv").exists())

    def test_multistatement_and_fence_tail_are_rejected(self):
        for sql in ["SELECT 1; SELECT 2", "SELECT 1; -- disguise\n SELECT 2",
                    f'SELECT 1; DROP TABLE "{self.table}"', "```sql\nSELECT 1\n```\nDROP TABLE x"]:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                self.engine.run_select(sql)

    def test_invalid_sql_inputs(self):
        for sql in [None, 1, [], {}, "", " \n ", "-- only comment", "/* unclosed", "SELECT FROM", "SELECT '"]:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                self.engine.run_select(sql)

    def test_nested_queries_ctes_and_subquery_limit(self):
        for sql in [f'SELECT AVG(col_2) AS mean FROM (SELECT * FROM "{self.table}") q',
                    f'WITH q AS (SELECT * FROM "{self.table}"), p AS (SELECT col_2 FROM q) SELECT AVG(col_2) AS mean FROM p']:
            with self.subTest(sql=sql):
                self.assertEqual(self.engine.run_select(sql)["rows"], [{"mean": 20.0}])
        sql = f'SELECT * FROM (SELECT * FROM "{self.table}" ORDER BY col_2 LIMIT 2) q ORDER BY col_2 DESC'
        self.assertEqual([r["col_2"] for r in self.engine.run_select(sql, limit=1)["rows"]], [20])

    def test_limit_argument_and_explicit_sql_limits(self):
        dataset = self.ingest_csv(pd.DataFrame({"id": range(1205)}), name="many.csv")
        table = dataset["sheets"][0]["table_name"]
        for limit, expected in [(-10**100, 1), (0, 1), (1, 1), (200, 200), (1000, 1000), (10**100, 1000), ("2", 2)]:
            with self.subTest(limit=limit):
                self.assertEqual(self.engine.run_select(f'SELECT * FROM "{table}"', limit)["row_count"], expected)
        for clause, limit, expected in [("LIMIT 10000", 10**100, 1000), ("LIMIT 10000", 2, 2),
                                        ("LIMIT 2", 200, 2), ("LIMIT 0", 200, 0), ("LIMIT ALL", 3, 3),
                                        ("LIMIT 5 OFFSET 4", 3, 3), ("LIMIT 5 -- trailing", 3, 3)]:
            with self.subTest(clause=clause, limit=limit):
                self.assertEqual(self.engine.run_select(f'SELECT * FROM "{table}" {clause}', limit)["row_count"], expected)

    def test_invalid_limits(self):
        for limit in [None, "", "abc", "2; DROP TABLE x", [], {}, 1.5, True, float("inf"), float("nan")]:
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                self.engine.run_select("SELECT 1", limit)

    def test_sql_nulls_are_json_serializable(self):
        result = self.engine.run_select("SELECT NULL::DOUBLE AS n, NULL::DATE AS d, NULL::VARCHAR AS s")
        self.assertEqual(result["rows"], [{"n": None, "d": None, "s": None}])
        json.dumps(result, allow_nan=False)

    def test_dataset_scope_allows_selected_and_rejects_other_references(self):
        other = self.ingest_csv(name="other.csv")
        denied = other["sheets"][0]["table_name"]
        ids = [self.dataset["dataset_id"]]
        self.assertEqual(self.engine.run_select(f'SELECT * FROM "{self.table}"', dataset_ids=ids)["row_count"], 3)
        for sql in [f'SELECT * FROM "{denied}"', f'SELECT * FROM main."{denied}"',
                    f'SELECT * FROM "{self.table}" UNION ALL SELECT * FROM "{denied}"',
                    f'SELECT a.* FROM "{self.table}" a JOIN "{denied}" b ON a.col_1=b.col_1',
                    f'SELECT * FROM "{self.table}" WHERE EXISTS (SELECT 1 FROM "{denied}")',
                    f'SELECT (SELECT COUNT(*) FROM "{denied}") FROM "{self.table}"',
                    f'WITH q AS (SELECT * FROM "{denied}") SELECT * FROM q',
                    f'WITH "{denied}" AS (SELECT * FROM "{self.table}") SELECT * FROM "{denied}" UNION SELECT * FROM main."{denied}"']:
            with self.subTest(sql=sql), self.assertRaisesRegex(ValueError, "scope"):
                self.engine.run_select(sql, dataset_ids=ids)
        both = ids + [other["dataset_id"]]
        self.assertEqual(self.engine.run_select(f'SELECT * FROM "{self.table}" UNION ALL SELECT * FROM "{denied}"', dataset_ids=both)["row_count"], 6)

    def test_empty_unknown_and_malformed_dataset_scope(self):
        for ids in [[], ["missing"], "abc", [None], [1]]:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                self.engine.run_select(f'SELECT * FROM "{self.table}"', dataset_ids=ids)

    def test_cte_alias_is_not_a_warehouse_reference(self):
        sql = f'WITH "{self.table}" AS (SELECT 42 AS value) SELECT * FROM "{self.table}"'
        self.assertEqual(self.engine.run_select(sql, dataset_ids=[])["rows"], [{"value": 42}])

    def test_unregistered_tables_catalog_and_external_access_are_rejected(self):
        with duckdb.connect(str(self.engine.db_path)) as conn:
            conn.execute("CREATE TABLE private_values AS SELECT 99 AS secret")
        path = str(self.root / "records.csv").replace("'", "''")
        for sql in ["SELECT * FROM private_values", "SELECT * FROM information_schema.tables",
                    "SELECT * FROM duckdb_tables()", "SELECT * FROM duckdb_settings()",
                    f"SELECT * FROM read_csv_auto('{path}')", f"SELECT * FROM sniff_csv('{path}')",
                    f"SELECT * FROM '{path}'", "SELECT * FROM query('SELECT * FROM private_values')"]:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                self.engine.run_select(sql)

    def test_preview_identifier_cannot_inject_a_second_statement(self):
        with self.assertRaises(ValueError):
            self.engine.preview_table(f'{self.table}"; DROP TABLE "{self.table}')
        self.assertEqual(self.engine.preview_table(self.table)["row_count"], 3)
