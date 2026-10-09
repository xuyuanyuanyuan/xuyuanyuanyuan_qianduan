from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import duckdb

from config import settings
from .registry import TableRegistry


class QueryEngine:
    def __init__(self, db_path: Path | None = None, registry: TableRegistry | None = None) -> None:
        self.db_path = db_path or settings.warehouse_db
        self.registry = registry if registry is not None else TableRegistry()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def run_select(
        self, sql: str, limit: int = 200, dataset_ids: list[str] | None = None
    ) -> dict[str, Any]:
        normalized = self._normalize_sql(sql)
        capped = self._cap_limit(limit)
        datasets = self.registry.filter(dataset_ids)
        allowed = {sheet["table_name"].lower() for dataset in datasets for sheet in dataset["sheets"]}
        exists = self.db_path.exists()

        # DuckDB read_only does not prevent SELECT from reading arbitrary files.
        with duckdb.connect(
            str(self.db_path) if exists else ":memory:",
            read_only=exists,
            config={"enable_external_access": False},
        ) as conn:
            try:
                canonical = self._validate_query(conn, normalized, allowed)
                limited_sql = self._add_limit(canonical, capped)
                if not exists:
                    return {"columns": [], "rows": [], "row_count": 0, "sql": limited_sql}
                result = conn.execute(limited_sql).fetchdf()
            except duckdb.Error as error:
                raise ValueError(f"Invalid table query: {error}") from error

        return {
            "columns": result.columns.tolist(),
            # Float/date columns otherwise keep NaN/NaT instead of JSON null.
            "rows": result.astype(object).where(result.notna(), None).to_dict(orient="records"),
            "row_count": len(result),
            "sql": limited_sql,
        }

    def preview_table(self, table_name: str, limit: int = 20) -> dict[str, Any]:
        if not isinstance(table_name, str) or not table_name.strip():
            raise ValueError("table_name must be a non-empty string.")
        return self.run_select(f"SELECT * FROM {self._quote_identifier(table_name)}", limit=limit)

    def _validate_query(self, conn, sql: str, allowed: set[str]) -> str:
        statements = conn.extract_statements(sql)
        if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
            raise ValueError("Only one read-only SELECT/WITH SQL query is permitted.")
        # Use DuckDB's own AST; regex cannot distinguish SQL from literals or
        # find references hidden in nested subqueries. This API is covered by
        # regressions against the pinned DuckDB version in requirements-tables.
        raw = conn.execute("SELECT json_serialize_sql(CAST(? AS VARCHAR))", [sql]).fetchone()[0]
        parsed = json.loads(raw)
        if parsed.get("error"):
            raise ValueError("Only read-only SELECT/WITH SQL queries are permitted.")
        self._validate_nodes(parsed)
        references = {name.lower() for name in conn.get_table_names(sql)}
        if references - allowed:
            raise ValueError("Table reference is outside the selected dataset scope.")
        # Canonicalization removes actual statement terminators and comments,
        # preserving semicolons/keywords inside literals and identifiers.
        return conn.execute("SELECT json_deserialize_sql(CAST(? AS JSON))", [raw]).fetchone()[0]

    def _validate_nodes(self, node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "TABLE_FUNCTION":
                raise ValueError("Table functions are outside the managed dataset scope.")
            if node.get("type") == "BASE_TABLE":
                if node.get("catalog_name") or node.get("schema_name", "").lower() not in {"", "main"}:
                    raise ValueError("Catalog/schema reference is outside the managed dataset scope.")
            if node.get("class") == "FUNCTION" and node.get("function_name", "").lower() in {
                "query", "query_table", "nextval", "setval",
            }:
                raise ValueError("Dynamic SQL/stateful functions are outside the managed dataset scope.")
            for value in node.values():
                self._validate_nodes(value)
        elif isinstance(node, list):
            for value in node:
                self._validate_nodes(value)

    def _normalize_sql(self, sql: str) -> str:
        if not isinstance(sql, str) or not sql.strip():
            raise ValueError("sql must be a non-empty string.")
        normalized = sql.strip().lstrip("\ufeff").strip()
        fenced = re.fullmatch(r"```(?:sql)?\s*(.*?)\s*```", normalized, re.IGNORECASE | re.DOTALL)
        if fenced:
            normalized = fenced.group(1).strip()
        elif normalized.startswith("`") and normalized.endswith("`") and not normalized.startswith("```"):
            normalized = normalized[1:-1].strip()
        normalized = re.sub(r"^sql\s*:\s*", "", normalized, flags=re.IGNORECASE).strip()
        normalized = self._strip_leading_comments(normalized)
        if not re.match(r"^(select|with)\b", normalized, re.IGNORECASE):
            raise ValueError("Only read-only SELECT/WITH SQL queries are permitted.")
        return normalized

    def _strip_leading_comments(self, sql: str) -> str:
        normalized = sql.strip()
        while True:
            if normalized.startswith("--"):
                _, _, normalized = normalized.partition("\n")
            elif normalized.startswith("/*"):
                depth, pos = 1, 2
                while depth and pos < len(normalized):
                    pair = normalized[pos:pos + 2]
                    if pair == "/*":
                        depth += 1
                        pos += 2
                    elif pair == "*/":
                        depth -= 1
                        pos += 2
                    else:
                        pos += 1
                if depth:
                    raise ValueError("Unterminated SQL comment.")
                normalized = normalized[pos:]
            else:
                return normalized
            normalized = normalized.strip()

    def _cap_limit(self, limit: int) -> int:
        if isinstance(limit, bool) or not (
            isinstance(limit, int) or isinstance(limit, str) and re.fullmatch(r"[+-]?\d+", limit.strip())
        ):
            raise ValueError("limit must be an integer or an integer string.")
        try:
            return max(1, min(int(limit), 1000))
        except (ValueError, OverflowError) as error:
            raise ValueError("limit must be an integer or an integer string.") from error

    def _add_limit(self, sql: str, limit: int) -> str:
        # An outer bound also caps explicit LIMIT/ALL/OFFSET, without changing
        # the meaning of nested limits or adding a second LIMIT clause.
        return f'SELECT * FROM ({sql}) AS "_table_result" LIMIT {limit}'

    def _quote_identifier(self, value: str) -> str:
        return '"' + value.replace('"', '""') + '"'
