from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb
import pandas as pd

from config import settings
from .registry import TableRegistry, utc_now_iso


class TableIngestor:
    def __init__(self, registry: TableRegistry | None = None) -> None:
        self.registry = registry or TableRegistry()
        settings.table_data_dir.mkdir(parents=True, exist_ok=True)
        settings.table_upload_dir.mkdir(parents=True, exist_ok=True)

    def ingest(
        self,
        file_path: Path,
        original_filename: str,
        description: str = "",
        project_name: str | None = None,
    ) -> dict[str, Any]:
        dataset_id = uuid4().hex
        frames = self._read_frames(file_path)
        sheets: list[dict[str, Any]] = []

        with duckdb.connect(str(settings.warehouse_db)) as conn:
            for index, (sheet_name, frame) in enumerate(frames.items(), start=1):
                normalized = self._normalize_frame(frame)
                sheet_id = f"{dataset_id}_s{index}"
                table_name = f"ds_{dataset_id}_s{index}"
                conn.register("incoming_frame", normalized)
                conn.execute(f'CREATE OR REPLACE TABLE "{table_name}" AS SELECT * FROM incoming_frame')
                conn.unregister("incoming_frame")

                sheets.append(
                    {
                        "sheet_id": sheet_id,
                        "sheet_name": str(sheet_name),
                        "table_name": table_name,
                        "row_count": len(normalized),
                        "columns": self._profile_columns(frame, normalized),
                    }
                )

        generated_desc = description.strip() or self._generate_description(
            original_filename, project_name, sheets
        )

        dataset = {
            "dataset_id": dataset_id,
            "original_filename": original_filename,
            "stored_path": str(file_path),
            "raw_description": description,
            "description": generated_desc,
            "project_name": project_name or "",
            "created_at": utc_now_iso(),
            "sheets": sheets,
            "quality_report": self._quality_report(sheets),
        }

        self.registry.save(dataset)
        return dataset

    def delete_dataset(self, dataset_id: str) -> bool:
        dataset = self.registry.get(dataset_id)
        if not dataset:
            return False

        with duckdb.connect(str(settings.warehouse_db)) as conn:
            for sheet in dataset.get("sheets", []):
                table_name = sheet.get("table_name")
                if table_name:
                    conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')

        return self.registry.delete(dataset_id)

    def _read_frames(self, file_path: Path) -> dict[str, pd.DataFrame]:
        suffix = file_path.suffix.lower()
        if suffix == ".csv":
            try:
                df = pd.read_csv(file_path, encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding="gbk", errors="replace")
            return {"Sheet1": df}
        if suffix in {".xlsx", ".xlsm", ".xls"}:
            return pd.read_excel(file_path, sheet_name=None)
        raise ValueError(f"Unsupported spreadsheet format: {suffix}")

    def _normalize_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        normalized = frame.copy()
        normalized.columns = [f"col_{index + 1}" for index in range(len(normalized.columns))]
        return normalized

    def _profile_columns(
        self, source: pd.DataFrame, normalized: pd.DataFrame
    ) -> list[dict[str, Any]]:
        profiles: list[dict[str, Any]] = []
        for index, source_name in enumerate(source.columns):
            sql_name = normalized.columns[index]
            series = source.iloc[:, index]
            non_null = series.dropna()
            numeric = pd.to_numeric(series, errors="coerce").dropna()

            profiles.append(
                {
                    "source_name": self._clean_source_name(source_name),
                    "sql_name": sql_name,
                    "dtype": str(series.dtype),
                    "non_null_count": int(series.notna().sum()),
                    "null_count": int(series.isna().sum()),
                    "sample_values": self._sample_values(non_null),
                    "numeric_min": float(numeric.min()) if not numeric.empty else None,
                    "numeric_max": float(numeric.max()) if not numeric.empty else None,
                    "numeric_mean": float(numeric.mean()) if not numeric.empty else None,
                    "business_role": self._guess_role(source_name),
                    "unit": self._guess_unit(source_name),
                    "description": "",
                    "quality_flags": self._column_quality_flags(series),
                }
            )
        return profiles

    def _sample_values(self, series: pd.Series) -> list[str]:
        values = []
        for value in series.astype(str).head(5).tolist():
            values.append(str(value)[:120])
        return values

    def _clean_source_name(self, value: object) -> str:
        text = str(value).strip()
        text = re.sub(r"\s+", " ", text)
        return text or "未命名字段"

    def _guess_role(self, value: object) -> str | None:
        text = str(value)
        role_keywords = [
            ("桩号", "桩号/构件编号"),
            ("编号", "桩号/构件编号"),
            ("日期", "施工日期"),
            ("时间", "施工日期"),
            ("桩长", "桩长"),
            ("长度", "长度"),
            ("贯入度", "贯入度/停锤贯入度"),
            ("锤击数", "总锤击数/阵击数"),
            ("击数", "锤击数"),
            ("终压力", "终压值"),
            ("终压值", "终压值"),
            ("压力", "终压值"),
            ("标高", "桩顶/桩底标高"),
            ("高程", "标高"),
            ("入土深度", "入土深度"),
            ("深度", "深度"),
            ("偏位", "桩身偏位"),
            ("地层", "地层/持力层"),
            ("土层", "地层/持力层"),
            ("岩层", "持力层"),
            ("桩型", "桩型/规格"),
            ("规格", "桩型/规格"),
            ("直径", "桩径"),
            ("班组", "施工班组"),
            ("机具", "施工机具/打桩机"),
            ("设备", "设备编号"),
            ("备注", "备注说明"),
        ]
        for keyword, role in role_keywords:
            if keyword in text:
                return role
        return None

    def _guess_unit(self, value: object) -> str | None:
        text = str(value)
        match = re.search(r"[(（]([a-zA-Z%°℃/0-9^³²]+)[)）]", text)
        if match:
            return match.group(1)
        if any(keyword in text for keyword in ["长", "深度", "标高", "高程", "桩长"]):
            return "m"
        if "贯入度" in text or "偏位" in text or "桩径" in text or "直径" in text:
            return "mm"
        if "终压" in text or "力" in text:
            return "kN"
        if "击数" in text or "锤击" in text:
            return "击"
        return None

    def _column_quality_flags(self, series: pd.Series) -> list[str]:
        flags: list[str] = []
        if series.isna().all():
            flags.append("全空列")
        if series.nunique(dropna=True) == 1 and len(series) > 1:
            flags.append("单值列")
        return flags

    def _quality_report(self, sheets: list[dict[str, Any]]) -> dict[str, Any]:
        total_columns = sum(len(sheet.get("columns", [])) for sheet in sheets)
        empty_columns = sum(
            1
            for sheet in sheets
            for column in sheet.get("columns", [])
            if "全空列" in column.get("quality_flags", [])
        )
        return {
            "total_sheets": len(sheets),
            "total_columns": total_columns,
            "empty_columns": empty_columns,
            "has_warnings": empty_columns > 0,
        }

    def _generate_description(
        self, original_filename: str, project_name: str | None, sheets: list[dict[str, Any]]
    ) -> str:
        total_rows = sum(s.get("row_count", 0) for s in sheets)
        parts = [
            f"表格文件: {original_filename} (共 {len(sheets)} 个 Sheet, {total_rows} 行数据)",
        ]
        if project_name:
            parts.append(f"所属项目: {project_name}")

        for sheet in sheets[:3]:
            col_names = [col.get("source_name", "") for col in sheet.get("columns", [])[:8]]
            parts.append(
                f"Sheet [{sheet.get('sheet_name')}]: {sheet.get('row_count')} 行, 主要字段包括: {', '.join(col_names)}"
            )

        return "；".join(parts)

