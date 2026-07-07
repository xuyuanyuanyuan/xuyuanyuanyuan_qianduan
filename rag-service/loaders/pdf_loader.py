"""
Structured PDF loader — preserves text layout, tables, and images.

Returns a list of DocumentBlock objects.  Callers (ingest.py) decide how
to chunk and embed each block type.

Scanned-PDF detection: if average extractable text per page is below
config.min_text_chars_per_page, load_pdf() returns an empty list so that
the caller can fall back to the existing OCR-text pipeline.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF


@dataclass
class DocumentBlock:
    block_type: str              # 'text' | 'table' | 'image'
    content: str                 # searchable text (table markdown or image caption)
    page: int                    # 1-based
    bbox: Optional[tuple] = None # (x0, y0, x1, y1) in PDF points
    section_title: Optional[str] = None

    # Table-specific
    table_markdown: Optional[str] = None
    table_csv: Optional[str] = None
    table_summary: Optional[str] = None

    # Image-specific
    image_path: Optional[str] = None   # relative URL: /static/images/…
    image_abs_path: Optional[str] = None  # absolute filesystem path

    extra: Dict[str, Any] = field(default_factory=dict)


def load_pdf(file_path: str) -> List[DocumentBlock]:
    """
    Parse a PDF into DocumentBlock objects.

    Returns [] for scanned / image-only PDFs (caller should use OCR path).
    Raises exceptions only for unreadable files; partial failures log and continue.
    """
    from config import settings
    from loaders.table_handler import extract_tables_from_page
    from loaders.image_handler import extract_images_from_page

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    doc = fitz.open(str(path))
    page_count = doc.page_count

    # --- Scanned PDF detection ---
    sample_pages = min(page_count, 5)
    total_chars = sum(
        len(doc[i].get_text("text").strip()) for i in range(sample_pages)
    )
    avg_chars = total_chars / sample_pages if sample_pages else 0
    if avg_chars < settings.min_text_chars_per_page:
        print(
            f"  {path.name}: avg {avg_chars:.0f} chars/page → scanned PDF, using OCR path.",
            flush=True,
        )
        doc.close()
        return []

    blocks: List[DocumentBlock] = []
    doc_stem = path.stem  # used as image filename prefix

    # --- pdfplumber for tables (optional dependency) ---
    plumber_pdf = None
    try:
        import pdfplumber
        plumber_pdf = pdfplumber.open(str(path))
    except ImportError:
        pass
    except Exception as e:
        print(f"  pdfplumber open failed ({e}); table extraction disabled.", flush=True)

    for page_idx in range(page_count):
        page_num = page_idx + 1
        fitz_page = doc[page_idx]

        # 1. Text blocks
        text = fitz_page.get_text("text").strip()
        if text:
            blocks.append(DocumentBlock(
                block_type="text",
                content=text,
                page=page_num,
            ))

        # 2. Tables (via pdfplumber)
        if plumber_pdf is not None:
            try:
                plumber_page = plumber_pdf.pages[page_idx]
                table_blocks = extract_tables_from_page(plumber_page, page_num)
                blocks.extend(table_blocks)
            except Exception as e:
                print(f"  Table extraction p{page_num} error: {e}", flush=True)

        # 3. Images (via PyMuPDF)
        try:
            image_blocks = extract_images_from_page(
                fitz_page, doc, page_num, doc_stem
            )
            blocks.extend(image_blocks)
        except Exception as e:
            print(f"  Image extraction p{page_num} error: {e}", flush=True)

    doc.close()
    if plumber_pdf is not None:
        plumber_pdf.close()

    print(
        f"  {path.name}: {page_count} pages → "
        f"{sum(1 for b in blocks if b.block_type=='text')} text, "
        f"{sum(1 for b in blocks if b.block_type=='table')} table, "
        f"{sum(1 for b in blocks if b.block_type=='image')} image blocks",
        flush=True,
    )
    return blocks
