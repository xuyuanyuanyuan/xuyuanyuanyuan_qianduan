-- Migration 002: Add tables and images auxiliary tables for Phase 2 multimodal parsing.
--
-- This file is DOCUMENTATION ONLY.
-- The actual migration is executed idempotently by:
--   python migrate.py        ← recommended (applies all phases)
--   or at service startup via VectorStore._init_db() + migrate._add_phase2_tables()
--
-- Note: Phase 1 migration (001) must already be applied (chunks_fts, documents, etc.)

-- Table-level extracted data (one row per table per PDF page)
CREATE TABLE IF NOT EXISTS tables (
    id        INTEGER PRIMARY KEY,
    doc_id    INTEGER,          -- FK → documents.id
    page      INTEGER,
    markdown  TEXT,             -- pipe-delimited markdown for display
    csv       TEXT,             -- raw CSV for processing
    summary   TEXT,             -- one-sentence LLM summary (may be NULL)
    bbox_json TEXT              -- [x0, y0, x1, y1] in PDF points (pdfplumber coords)
);

-- Image-level extracted data (one row per image per PDF page)
CREATE TABLE IF NOT EXISTS images (
    id         INTEGER PRIMARY KEY,
    doc_id     INTEGER,         -- FK → documents.id
    page       INTEGER,
    image_path TEXT,            -- relative URL: /static/images/{filename}
    caption    TEXT,            -- LLM-generated caption (may be NULL if disabled)
    bbox_json  TEXT             -- [x0, y0, x1, y1] in PDF points (PyMuPDF coords)
);

-- Chunk schema additions (already applied in 001; listed here for reference):
-- chunks.block_type = 'text' | 'table' | 'image'
-- chunks.metadata_json stores:
--   for 'table' chunks: {"table_markdown": "..."}
--   for 'image' chunks: {"image_path": "/static/images/..."}