from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TableRegistry:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or settings.table_registry_db
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    dataset_id TEXT PRIMARY KEY,
                    original_filename TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    description TEXT NOT NULL,
                    raw_description TEXT NOT NULL,
                    project_name TEXT,
                    created_at TEXT NOT NULL,
                    sheet_count INTEGER NOT NULL,
                    total_rows INTEGER NOT NULL,
                    sheets_json TEXT NOT NULL,
                    quality_report_json TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def save(self, dataset: dict[str, Any]) -> None:
        sheet_count = len(dataset.get("sheets", []))
        total_rows = sum(int(sheet.get("row_count", 0)) for sheet in dataset.get("sheets", []))

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO datasets (
                    dataset_id, original_filename, stored_path, description,
                    raw_description, project_name, created_at, sheet_count,
                    total_rows, sheets_json, quality_report_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dataset["dataset_id"],
                    dataset.get("original_filename", ""),
                    dataset.get("stored_path", ""),
                    dataset.get("description", ""),
                    dataset.get("raw_description", ""),
                    dataset.get("project_name"),
                    dataset.get("created_at", utc_now_iso()),
                    sheet_count,
                    total_rows,
                    json.dumps(dataset.get("sheets", []), ensure_ascii=False),
                    json.dumps(dataset.get("quality_report", {}), ensure_ascii=False),
                ),
            )
            conn.commit()

    def list(self) -> list[dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT dataset_id, original_filename, project_name, description,
                       raw_description, created_at, sheet_count, total_rows
                FROM datasets
                ORDER BY created_at DESC
                """
            )
            rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get(self, dataset_id: str) -> dict[str, Any] | None:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT dataset_id, original_filename, stored_path, description,
                       raw_description, project_name, created_at, sheet_count,
                       total_rows, sheets_json, quality_report_json
                FROM datasets
                WHERE dataset_id = ?
                """,
                (dataset_id,),
            )
            row = cursor.fetchone()

        if row is None:
            return None

        data = dict(row)
        data["sheets"] = json.loads(data.pop("sheets_json") or "[]")
        data["quality_report"] = json.loads(data.pop("quality_report_json") or "{}")
        return data

    def filter(self, dataset_ids: list[str] | None = None) -> list[dict[str, Any]]:
        all_datasets = [self.get(item["dataset_id"]) for item in self.list()]
        valid = [item for item in all_datasets if item is not None]
        if not dataset_ids:
            return valid
        allowed = set(dataset_ids)
        return [item for item in valid if item["dataset_id"] in allowed]

    def delete(self, dataset_id: str) -> bool:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM datasets WHERE dataset_id = ?", (dataset_id,))
            conn.commit()
            return cursor.rowcount > 0

    def count(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM datasets")
            row = cursor.fetchone()
            return int(row[0]) if row else 0

