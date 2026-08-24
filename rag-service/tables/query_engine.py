from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import duckdb

from config import settings


FORBIDDEN_SQL = re.compile(
    r"\b(insert|update|delete|drop|alter|create|copy|attach|detach|pragma|set|call|load|install|export|import)\b",
    re.IGNORECASE,
)


class QueryEngine:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or settings.warehouse_db
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def run_select(self, sql: str, limit: int = 200) -> dict[str, Any]:
        normalized = self._normalize_sql(sql)
        if not self._is_safe_select(normalized):
            raise ValueError("Only read-only SELECT/WITH SQL queries are permitted.")

        limited_sql = self._add_limit(normalized, limit)
        if not self.db_path.exists():
            return {
                "columns": [],
                "rows": [],
                "row_count": 0,
                "sql": limited_sql,
            }

        with duckdb.connect(str(self.db_path), read_only=True) as conn:
            result = conn.execute(limited_sql).fetchdf()

        return {
            "columns": result.columns.tolist(),
            "rows": result.where(result.notna(), None).to_dict(orient="records"),
            "row_count": len(result),
            "sql": limited_sql,
        }

    def preview_table(self, table_name: str, limit: int = 20) -> dict[str, Any]:
        safe_table = self._quote_identifier(table_name)
        return self.run_select(f"SELECT * FROM {safe_table}", limit=limit)

    def _is_safe_select(self, sql: str) -> bool:
        lowered = sql.lower()
        if ";" in sql:
            return False
        if FORBIDDEN_SQL.search(sql):
            return False
        return lowered.startswith("select ") or lowered.startswith("with ")

    def _normalize_sql(self, sql: str) -> str:
        normalized = sql.strip().lstrip("\ufeff")
        fenced = re.search(r"```(?:sql)?\s*(.*?)```", normalized, re.IGNORECASE | re.DOTALL)
        if fenced:
            normalized = fenced.group(1).strip()
        if normalized.startswith("`") and normalized.endswith("`"):
            normalized = normalized[1:-1].strip()
        normalized = re.sub(r"^\s*sql\s*:\s*", "", normalized, flags=re.IGNORECASE).strip()
        normalized = self._strip_leading_comments(normalized)
        if normalized.endswith(";") and normalized.count(";") == 1:
            normalized = normalized[:-1].rstrip()
        return normalized

    def _strip_leading_comments(self, sql: str) -> str:
        normalized = sql.strip()
        while True:
            if normalized.startswith("--"):
                _, _, remainder = normalized.partition("\n")
                normalized = remainder.strip()
                continue
            if normalized.startswith("/*"):
                end = normalized.find("*/")
                if end == -1:
                    return normalized
                normalized = normalized[end + 2 :].strip()
                continue
            return normalized

    def _add_limit(self, sql: str, limit: int) -> str:
        capped = max(1, min(int(limit), 1000))
        if re.search(r"\blimit\s+\d+\s*$", sql, re.IGNORECASE):
            return sql
        return f"{sql} LIMIT {capped}"

    def _quote_identifier(self, value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

