"""
Standalone migration runner.

Usage:
    python migrate.py            # apply schema changes (idempotent)
    python migrate.py --status   # print DB stats without changing anything

The actual migration logic lives inside VectorStore._init_db() so the service
can also self-migrate on startup. This script is a convenience wrapper that
also back-fills chunks_fts for any existing rows that haven't been indexed yet.
"""
import argparse
import json
import sys
from pathlib import Path

# Ensure rag-service/ is on sys.path when called directly.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings
from ingest import VectorStore, _store_path


def _get_db_path() -> Path:
    return _store_path()


def status(db_path: Path) -> None:
    import sqlite3

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        print("Run 'python ingest.py' to create it.")
        return

    conn = sqlite3.connect(str(db_path))

    chunks_total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    parents = conn.execute(
        "SELECT COUNT(*) FROM chunks WHERE parent_id IS NULL"
    ).fetchone()[0]
    children = chunks_total - parents

    fts_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
    ).fetchone()
    fts_count = 0
    if fts_table:
        fts_count = conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]

    logs = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='search_logs'"
    ).fetchone()
    log_count = 0
    if logs:
        log_count = conn.execute("SELECT COUNT(*) FROM search_logs").fetchone()[0]

    tbl_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tables'"
    ).fetchone()
    tbl_count = 0
    if tbl_table:
        tbl_count = conn.execute("SELECT COUNT(*) FROM tables").fetchone()[0]

    img_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='images'"
    ).fetchone()
    img_count = 0
    if img_table:
        img_count = conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]

    conn.close()

    print(f"Database : {db_path}")
    print(f"Chunks   : {chunks_total} total  ({parents} parents, {children} children)")
    print(f"FTS rows : {fts_count}  (table exists: {fts_table is not None})")
    print(f"Tables   : {tbl_count}  (table exists: {tbl_table is not None})")
    print(f"Images   : {img_count}  (table exists: {img_table is not None})")
    print(f"Log rows : {log_count}")


def _add_phase2_tables(conn: "sqlite3.Connection") -> None:
    """Create tables and images tables (Phase 2). Idempotent."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tables (
            id       INTEGER PRIMARY KEY,
            doc_id   INTEGER,
            page     INTEGER,
            markdown TEXT,
            csv      TEXT,
            summary  TEXT,
            bbox_json TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS images (
            id         INTEGER PRIMARY KEY,
            doc_id     INTEGER,
            page       INTEGER,
            image_path TEXT,
            caption    TEXT,
            bbox_json  TEXT
        )
    """)
    conn.commit()


def migrate(db_path: Path) -> None:
    import sqlite3

    print(f"Running migration on: {db_path}")
    # VectorStore._init_db() handles Phase 1 schema changes idempotently.
    store = VectorStore(str(db_path))
    print(f"Schema migration complete. FTS5 available: {store._fts_ok}")

    conn = sqlite3.connect(str(db_path))

    # Phase 2: tables and images
    _add_phase2_tables(conn)
    print("Phase 2 tables (tables, images) ensured.")

    if not store._fts_ok:
        print("FTS5 not available — BM25 will use rank-bm25 fallback at query time.")
        conn.close()
        return

    # Back-fill chunks_fts for rows that were inserted before this migration.
    existing_chunks = conn.execute(
        "SELECT id, document, section_path FROM chunks"
    ).fetchall()
    indexed_ids = {
        r[0] for r in conn.execute("SELECT chunk_id FROM chunks_fts").fetchall()
    }
    to_index = [
        (r[0], r[1], r[2] or "")
        for r in existing_chunks
        if r[0] not in indexed_ids
    ]
    if to_index:
        conn.executemany(
            "INSERT INTO chunks_fts (chunk_id, content, section_path) VALUES (?,?,?)",
            to_index,
        )
        conn.commit()
        print(f"Back-filled {len(to_index)} chunks into chunks_fts.")
    else:
        print("chunks_fts already up to date — nothing to back-fill.")
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG 数据库迁移工具")
    parser.add_argument(
        "--status",
        action="store_true",
        help="只显示数据库状态，不做任何修改。",
    )
    args = parser.parse_args()

    db_path = _get_db_path()

    if args.status:
        status(db_path)
    else:
        migrate(db_path)
        print()
        status(db_path)


if __name__ == "__main__":
    main()
