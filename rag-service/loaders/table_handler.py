"""
Table extraction from pdfplumber Page objects.

Each detected table produces a DocumentBlock with:
  - content       = summary + "\n\n" + markdown  (for embedding + FTS)
  - table_markdown = full markdown representation
  - table_csv     = CSV representation
  - table_summary = one-sentence LLM description (if enabled)
"""
from __future__ import annotations

import csv
import io
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from loaders.pdf_loader import DocumentBlock


def _table_to_markdown(rows: List[List[Optional[str]]]) -> str:
    if not rows:
        return ""

    # Normalise: replace None → "", strip cells
    cleaned = [[str(c).strip() if c is not None else "" for c in row] for row in rows]
    col_count = max(len(r) for r in cleaned)

    def pad_row(row: List[str]) -> List[str]:
        return row + [""] * (col_count - len(row))

    header = pad_row(cleaned[0])
    body   = [pad_row(r) for r in cleaned[1:]]

    lines = ["| " + " | ".join(header) + " |"]
    lines.append("|" + "|".join("---" for _ in header) + "|")
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _table_to_csv(rows: List[List[Optional[str]]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow([str(c) if c is not None else "" for c in row])
    return buf.getvalue()


def _generate_table_summary(table_markdown: str) -> Optional[str]:
    """Call the LLM to produce a one-sentence summary of the table."""
    from config import settings
    if not settings.generate_table_summaries:
        return None
    if not settings.llm_api_key or not settings.llm_base_url:
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)
        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "请用一句话总结以下表格的主要内容，格式：\"本表规定了...的...和...\"。\n\n"
                        f"{table_markdown[:2000]}"
                    ),
                }
            ],
            max_tokens=100,
            temperature=0.1,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"    Table summary LLM error: {e}", flush=True)
        return None


def extract_tables_from_page(plumber_page: object, page_num: int) -> List["DocumentBlock"]:
    """
    Extract all tables from a pdfplumber Page.
    Returns a list of DocumentBlock (block_type='table').
    """
    from loaders.pdf_loader import DocumentBlock

    try:
        raw_tables = plumber_page.extract_tables()
    except Exception:
        return []

    if not raw_tables:
        return []

    blocks: List[DocumentBlock] = []
    for t_idx, rows in enumerate(raw_tables):
        if not rows or all(all(c is None for c in row) for row in rows):
            continue

        markdown = _table_to_markdown(rows)
        csv_text = _table_to_csv(rows)
        summary  = _generate_table_summary(markdown)

        # Searchable content = summary (if present) + markdown
        parts = []
        if summary:
            parts.append(summary)
        parts.append(markdown)
        content = "\n\n".join(parts)

        # Bounding box from pdfplumber (PDF coords: origin bottom-left)
        bbox = None
        try:
            table_objs = plumber_page.find_tables()
            if t_idx < len(table_objs):
                b = table_objs[t_idx].bbox
                bbox = (b[0], b[1], b[2], b[3])
        except Exception:
            pass

        blocks.append(DocumentBlock(
            block_type="table",
            content=content,
            page=page_num,
            bbox=bbox,
            table_markdown=markdown,
            table_csv=csv_text,
            table_summary=summary,
        ))

    return blocks
