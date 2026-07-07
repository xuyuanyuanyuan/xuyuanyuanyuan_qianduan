-- Migration 001: Add FTS5 full-text index, parent-child columns, and auxiliary tables.
--
-- This file is DOCUMENTATION ONLY.
-- The actual migration is executed idempotently by VectorStore._init_db() (ingest.py)
-- every time the service starts, and by migrate.py which also back-fills chunks_fts.
--
-- To apply manually:
--   python migrate.py
--
-- To verify state:
--   python migrate.py --status

-- 1. New columns on chunks (added via ALTER TABLE … ADD COLUMN IF NOT EXISTS in Python)
--
ALTER TABLE chunks ADD COLUMN parent_id     TEXT;
ALTER TABLE chunks ADD COLUMN section_path  TEXT;
ALTER TABLE chunks ADD COLUMN page_start    INTEGER;
ALTER TABLE chunks ADD COLUMN page_end      INTEGER;
ALTER TABLE chunks ADD COLUMN block_type    TEXT DEFAULT 'text';  -- text | table | image
ALTER TABLE chunks ADD COLUMN metadata_json TEXT;

-- 2. FTS5 virtual table for BM25 keyword search.
--    unicode61 tokenizer handles ASCII and CJK characters without jieba.
--
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id    UNINDEXED,   -- TEXT, matches chunks.id
    content,
    section_path,
    tokenize='unicode61'
);

-- 3. Document registry (one row per source file)
--
CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY,
    filename   TEXT NOT NULL,
    file_path  TEXT NOT NULL,
    file_type  TEXT,
    checksum   TEXT UNIQUE,
    page_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Search audit log (written by hybrid_search on every query)
--
CREATE TABLE IF NOT EXISTS search_logs (
    id             INTEGER PRIMARY KEY,
    query          TEXT,
    retrieved_ids  TEXT,    -- JSON array of chunk IDs after RRF (top-N)
    final_ids      TEXT,    -- JSON array of chunk IDs after rerank (top-K)
    latency_ms     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Phase 2 placeholders (created in Migration 002)
--
-- CREATE TABLE IF NOT EXISTS tables  (id INTEGER PRIMARY KEY, doc_id INTEGER, page INTEGER,
--     markdown TEXT, csv TEXT, summary TEXT, bbox_json TEXT);
-- CREATE TABLE IF NOT EXISTS images  (id INTEGER PRIMARY KEY, doc_id INTEGER, page INTEGER,
--     image_path TEXT, caption TEXT, bbox_json TEXT);
