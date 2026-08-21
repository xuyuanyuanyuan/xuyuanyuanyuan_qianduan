import json
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fitz
import numpy as np
import openai

from config import settings


PAGE_HEADER_PATTERN = re.compile(r"^\s*\[PAGE\s+(\d+)\]\s*(?:\r?\n)?", re.IGNORECASE)
PAGE_FILENAME_PATTERN = re.compile(r"(?:^|[_-])page[_-]?(\d+)$", re.IGNORECASE)

_EMBED_BATCH = 256
_SQL_BATCH = 500

# Incremented on every upsert so hybrid_search can invalidate its embedding cache.
_embed_cache_version: int = 0


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _split_text(text: str, chunk_size: int = 650, overlap: int = 120) -> List[str]:
    clean = _normalize_text(text)
    if not clean:
        return []

    sentences = re.split(r"(?<=[。！？!?])\s*", clean)
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        if not sentence:
            continue
        if len(current) + len(sentence) <= chunk_size:
            current += sentence
        else:
            if current:
                chunks.append(current.strip())
            current = sentence
            while len(current) > chunk_size:
                chunks.append(current[:chunk_size].strip())
                current = current[chunk_size - overlap:]

    if current:
        chunks.append(current.strip())

    return chunks


def _split_parent_child(
    text: str,
) -> List[Tuple[str, List[str]]]:
    """Split text into (parent_text, [child_texts]) pairs for small-to-big retrieval."""
    parents = _split_text(
        text,
        chunk_size=settings.parent_chunk_size,
        overlap=settings.parent_chunk_overlap,
    )
    result: List[Tuple[str, List[str]]] = []
    for parent in parents:
        children = _split_text(
            parent,
            chunk_size=settings.child_chunk_size,
            overlap=settings.child_chunk_overlap,
        )
        result.append((parent, children))
    return result


# ---------------------------------------------------------------------------
# Pure-Python vector store (SQLite + numpy) — no C extension dependencies
# ---------------------------------------------------------------------------

class VectorStore:
    def __init__(self, db_path: str):
        self._db = Path(db_path)
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._fts_ok: bool = False
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self._db))

    def _init_db(self) -> None:
        with self._conn() as conn:
            # Base chunks table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    id       TEXT PRIMARY KEY,
                    document TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    embedding TEXT NOT NULL
                )
            """)

            # Idempotent column additions for existing databases
            _new_cols = [
                ("parent_id",     "TEXT"),
                ("section_path",  "TEXT"),
                ("page_start",    "INTEGER"),
                ("page_end",      "INTEGER"),
                ("block_type",    "TEXT DEFAULT 'text'"),
                ("metadata_json", "TEXT"),
            ]
            for col_name, col_def in _new_cols:
                try:
                    conn.execute(f"ALTER TABLE chunks ADD COLUMN {col_name} {col_def}")
                except sqlite3.OperationalError:
                    pass  # column already exists

            # FTS5 virtual table (unicode61 handles CJK characters)
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                        chunk_id UNINDEXED,
                        content,
                        section_path,
                        tokenize='unicode61'
                    )
                """)
                self._fts_ok = True
            except Exception as e:
                print(f"FTS5 not available ({e}); BM25 will use rank-bm25 fallback.")
                self._fts_ok = False

            # Documents table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id         INTEGER PRIMARY KEY,
                    filename   TEXT NOT NULL,
                    file_path  TEXT NOT NULL,
                    file_type  TEXT,
                    checksum   TEXT UNIQUE,
                    page_count INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Search logs table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS search_logs (
                    id             INTEGER PRIMARY KEY,
                    query          TEXT,
                    retrieved_ids  TEXT,
                    final_ids      TEXT,
                    latency_ms     INTEGER,
                    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Structured PDF ingest writes extracted tables and images into
            # the same SQLite database. Create these tables here so a fresh
            # server can ingest without requiring a separate migration step.
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tables (
                    id        INTEGER PRIMARY KEY,
                    doc_id    INTEGER,
                    page      INTEGER,
                    markdown  TEXT,
                    csv       TEXT,
                    summary   TEXT,
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

    def upsert(
        self,
        ids: List[str],
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        embeddings: List[List[float]],
        parent_ids: Optional[List[Optional[str]]] = None,
        section_paths: Optional[List[Optional[str]]] = None,
        page_starts: Optional[List[Optional[int]]] = None,
        page_ends: Optional[List[Optional[int]]] = None,
        block_types: Optional[List[Optional[str]]] = None,
        metadata_jsons: Optional[List[Optional[str]]] = None,
    ) -> None:
        _parent_ids    = parent_ids    or [None]   * len(ids)
        _section_paths = section_paths or [None]   * len(ids)
        _page_starts   = page_starts   or [None]   * len(ids)
        _page_ends     = page_ends     or [None]   * len(ids)
        _block_types   = block_types   or ["text"] * len(ids)
        _meta_jsons    = metadata_jsons or [None]  * len(ids)

        rows = [
            (
                id_, doc,
                json.dumps(meta, ensure_ascii=False),
                json.dumps(emb),
                pid, sp, ps, pe, bt, mj,
            )
            for id_, doc, meta, emb, pid, sp, ps, pe, bt, mj in zip(
                ids, documents, metadatas, embeddings,
                _parent_ids, _section_paths, _page_starts, _page_ends,
                _block_types, _meta_jsons,
            )
        ]

        with self._conn() as conn:
            for i in range(0, len(rows), _SQL_BATCH):
                conn.executemany(
                    """INSERT OR REPLACE INTO chunks
                       (id, document, metadata, embedding,
                        parent_id, section_path, page_start, page_end,
                        block_type, metadata_json)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    rows[i : i + _SQL_BATCH],
                )

            if self._fts_ok:
                fts_rows = [
                    (id_, doc, sp or "")
                    for id_, doc, sp in zip(ids, documents, _section_paths)
                ]
                conn.executemany(
                    "DELETE FROM chunks_fts WHERE chunk_id=?",
                    [(id_,) for id_ in ids],
                )
                conn.executemany(
                    "INSERT INTO chunks_fts (chunk_id, content, section_path) VALUES (?,?,?)",
                    fts_rows,
                )

        # Signal hybrid_search to reload its embedding cache.
        global _embed_cache_version
        _embed_cache_version += 1

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]

    def query(
        self,
        query_embeddings: List[List[float]],
        n_results: int,
        include: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT document, metadata, embedding FROM chunks"
            ).fetchall()

        if not rows:
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

        docs  = [r[0] for r in rows]
        metas = [json.loads(r[1]) for r in rows]
        embs  = np.array([json.loads(r[2]) for r in rows], dtype=np.float32)

        q = np.array(query_embeddings[0], dtype=np.float32)

        norms = np.linalg.norm(embs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        q_norm = float(np.linalg.norm(q)) or 1.0
        sims = (embs / norms) @ (q / q_norm)

        top_k   = min(n_results, len(rows))
        top_idx = np.argsort(sims)[::-1][:top_k]

        return {
            "documents": [[docs[i]  for i in top_idx]],
            "metadatas": [[metas[i] for i in top_idx]],
            "distances": [[float(1.0 - sims[i]) for i in top_idx]],
        }


def _store_path() -> Path:
    return Path(settings.chroma_persist_directory) / "store.db"


_store_instance: Optional[VectorStore] = None


def _get_store() -> VectorStore:
    global _store_instance
    if _store_instance is None:
        _store_instance = VectorStore(str(_store_path()))
    return _store_instance


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def _embedding_config_warning() -> Optional[str]:
    base_url = (settings.openai_base_url or "").strip().lower().rstrip("/")
    model    = (settings.openai_embedding_model or "").strip()
    warnings: List[str] = []
    if "api.deepseek.com" in base_url:
        warnings.append(
            "检测到 OPENAI_BASE_URL 指向 DeepSeek 官方 API。该地址当前不提供 /v1/embeddings 接口，"
            "RAG 向量化会返回 404。请改用支持 embeddings 的服务。"
        )
    if model.lower() == "text-embedding":
        warnings.append(
            "OPENAI_EMBEDDING_MODEL=text-embedding 看起来像占位名，不是常见的实际模型 ID。"
        )
    return " ".join(warnings) if warnings else None


def _simple_embedding(texts: List[str]) -> List[List[float]]:
    import hashlib
    embeddings = []
    for text in texts:
        h = hashlib.sha256(text.encode()).digest()
        embeddings.append([float(b) / 255.0 for b in h[:64]])
    return embeddings


def _compute_embeddings(texts: List[str]) -> List[List[float]]:
    provider = (settings.embedding_provider or "").strip().lower()

    if provider in {"simple_hash", "hash"}:
        return _simple_embedding(texts)

    if provider == "openai_compatible":
        config_warning = _embedding_config_warning()
        if config_warning:
            print(f"Embedding config warning: {config_warning}", flush=True)
        try:
            from openai import OpenAI
            client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
            all_embeddings: List[List[float]] = []
            total_batches = (len(texts) + _EMBED_BATCH - 1) // _EMBED_BATCH
            for i in range(total_batches):
                batch = texts[i * _EMBED_BATCH : (i + 1) * _EMBED_BATCH]
                response = client.embeddings.create(
                    model=settings.openai_embedding_model,
                    input=batch,
                )
                all_embeddings.extend([item.embedding for item in response.data])
                if total_batches > 1:
                    print(f"  embedding batch {i + 1}/{total_batches}", flush=True)
            return all_embeddings
        except Exception as e:
            print(f"Embedding error: {e}, falling back to simple hash embedding", flush=True)
            return _simple_embedding(texts)

    raise RuntimeError("当前仅支持 openai_compatible 或 simple_hash 嵌入器。")


# ---------------------------------------------------------------------------
# PDF / TXT ingestion
# ---------------------------------------------------------------------------

def _load_pdf_text(pdf_path: Path) -> List[Tuple[int, str]]:
    document = fitz.open(pdf_path)
    result = []
    for page_number in range(document.page_count):
        page = document[page_number]
        text = page.get_text("text")
        if text.strip():
            result.append((page_number + 1, text))
    return result


def _extract_page_number_from_text(text: str) -> Optional[int]:
    match = PAGE_HEADER_PATTERN.match(text)
    return int(match.group(1)) if match else None


def _extract_page_number_from_filename(txt_path: Path) -> Optional[int]:
    match = PAGE_FILENAME_PATTERN.search(txt_path.stem)
    return int(match.group(1)) if match else None


def _strip_page_header(text: str) -> str:
    return PAGE_HEADER_PATTERN.sub("", text, count=1).strip()


def _txt_source_name(txt_path: Path) -> str:
    try:
        return txt_path.relative_to(Path(settings.knowledge_path)).as_posix()
    except ValueError:
        return txt_path.name


def _read_txt(txt_path: Path) -> str:
    for enc in ("utf-8", "gbk", "gb18030", "utf-8-sig"):
        try:
            return txt_path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return txt_path.read_text(encoding="utf-8", errors="replace")


def _build_chunks_for_page(
    page_text: str,
    page_number: int,
    source_name: str,
    id_prefix: str,
) -> Tuple[List[str], List[str], List[Dict[str, Any]], List[Optional[str]], List[Optional[int]], List[Optional[int]]]:
    """Return (ids, texts, metadatas, parent_ids, page_starts, page_ends)."""
    ids: List[str] = []
    texts: List[str] = []
    metadatas: List[Dict[str, Any]] = []
    parent_id_list: List[Optional[str]] = []
    page_starts: List[Optional[int]] = []
    page_ends: List[Optional[int]] = []

    if settings.use_parent_child_chunking:
        pairs = _split_parent_child(page_text)
        for p_idx, (parent_text, children) in enumerate(pairs):
            parent_id = f"{id_prefix}-{page_number}-p{p_idx}"
            ids.append(parent_id)
            texts.append(parent_text)
            metadatas.append({
                "source": source_name,
                "page": page_number,
                "chunk_id": p_idx,
                "is_parent": True,
            })
            parent_id_list.append(None)
            page_starts.append(page_number)
            page_ends.append(page_number)

            for c_idx, child_text in enumerate(children):
                child_id = f"{id_prefix}-{page_number}-p{p_idx}-c{c_idx}"
                ids.append(child_id)
                texts.append(child_text)
                metadatas.append({
                    "source": source_name,
                    "page": page_number,
                    "chunk_id": c_idx,
                    "is_parent": False,
                })
                parent_id_list.append(parent_id)
                page_starts.append(page_number)
                page_ends.append(page_number)
    else:
        chunks = _split_text(page_text)
        for chunk_index, chunk in enumerate(chunks):
            ids.append(f"{id_prefix}-{page_number}-{chunk_index}")
            texts.append(chunk)
            metadatas.append({
                "source": source_name,
                "page": page_number,
                "chunk_id": chunk_index,
            })
            parent_id_list.append(None)
            page_starts.append(page_number)
            page_ends.append(page_number)

    return ids, texts, metadatas, parent_id_list, page_starts, page_ends


# ---------------------------------------------------------------------------
# Phase 2: Document registry + table/image DB helpers
# ---------------------------------------------------------------------------

def _upsert_document(pdf_path: Path) -> int:
    """Insert or retrieve the documents-table row for a PDF. Returns doc_id."""
    import hashlib
    try:
        checksum = hashlib.md5(pdf_path.read_bytes()).hexdigest()
    except Exception:
        checksum = pdf_path.name  # fallback key

    doc_count = 0
    try:
        doc = fitz.open(str(pdf_path))
        doc_count = doc.page_count
        doc.close()
    except Exception:
        pass

    conn = sqlite3.connect(str(_store_path()))
    row = conn.execute(
        "SELECT id FROM documents WHERE checksum=?", (checksum,)
    ).fetchone()
    if row:
        conn.close()
        return row[0]

    cur = conn.execute(
        "INSERT OR IGNORE INTO documents (filename, file_path, file_type, checksum, page_count) "
        "VALUES (?,?,?,?,?)",
        (pdf_path.name, str(pdf_path), "pdf", checksum, doc_count),
    )
    conn.commit()
    doc_id = cur.lastrowid or conn.execute(
        "SELECT id FROM documents WHERE checksum=?", (checksum,)
    ).fetchone()[0]
    conn.close()
    return doc_id


def _insert_table(
    doc_id: int,
    page: int,
    markdown: str,
    csv_text: str,
    summary: Optional[str],
    bbox: Optional[tuple],
) -> int:
    """Insert a row into the tables table. Returns table row id."""
    conn = sqlite3.connect(str(_store_path()))
    cur = conn.execute(
        "INSERT INTO tables (doc_id, page, markdown, csv, summary, bbox_json) VALUES (?,?,?,?,?,?)",
        (doc_id, page, markdown, csv_text, summary,
         json.dumps(list(bbox)) if bbox else None),
    )
    row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return row_id


def _insert_image(
    doc_id: int,
    page: int,
    image_path: str,
    caption: Optional[str],
    bbox: Optional[tuple],
) -> int:
    """Insert a row into the images table. Returns image row id."""
    conn = sqlite3.connect(str(_store_path()))
    cur = conn.execute(
        "INSERT INTO images (doc_id, page, image_path, caption, bbox_json) VALUES (?,?,?,?,?)",
        (doc_id, page, image_path, caption,
         json.dumps(list(bbox)) if bbox else None),
    )
    row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return row_id


def ingest_pdf(pdf_path: Path, store: VectorStore) -> int:
    print(f"处理 PDF：{pdf_path}", flush=True)

    # --- Try structured loader (Phase 2 path) ---
    try:
        from loaders.pdf_loader import load_pdf, DocumentBlock
        blocks = load_pdf(str(pdf_path))
    except Exception as e:
        print(f"  Structured loader failed ({e}); falling back to legacy text extraction.", flush=True)
        blocks = []

    if blocks:
        return _ingest_pdf_structured(pdf_path, store, blocks)

    # --- Fallback: legacy text-only extraction ---
    return _ingest_pdf_legacy(pdf_path, store)


def _ingest_pdf_legacy(pdf_path: Path, store: VectorStore) -> int:
    """Original page-text extraction path (used for scanned PDFs)."""
    all_ids: List[str] = []
    all_texts: List[str] = []
    all_metas: List[Dict[str, Any]] = []
    all_parent_ids: List[Optional[str]] = []
    all_page_starts: List[Optional[int]] = []
    all_page_ends: List[Optional[int]] = []

    id_prefix = pdf_path.name
    for page_number, page_text in _load_pdf_text(pdf_path):
        ids, texts, metas, pids, pstarts, pends = _build_chunks_for_page(
            page_text, page_number, pdf_path.name, id_prefix
        )
        all_ids.extend(ids)
        all_texts.extend(texts)
        all_metas.extend(metas)
        all_parent_ids.extend(pids)
        all_page_starts.extend(pstarts)
        all_page_ends.extend(pends)

    if not all_texts:
        print(
            f"Warning: {pdf_path.name} 没有可提取的文本，可能是扫描版本，请使用OCR处理",
            flush=True,
        )
        return 0

    try:
        embeddings = _compute_embeddings(all_texts)
    except Exception as e:
        print(f"Embedding failed for {pdf_path}: {e}", flush=True)
        return 0

    try:
        store.upsert(
            all_ids, all_texts, all_metas, embeddings,
            parent_ids=all_parent_ids,
            page_starts=all_page_starts,
            page_ends=all_page_ends,
        )
    except Exception as e:
        print(f"Store upsert failed for {pdf_path}: {e}", flush=True)
        return 0

    return len(all_texts)


def _ingest_pdf_structured(
    pdf_path: Path,
    store: VectorStore,
    blocks: "List[DocumentBlock]",
) -> int:
    """Ingest structured DocumentBlocks (text + table + image)."""
    from loaders.pdf_loader import DocumentBlock

    doc_id = _upsert_document(pdf_path)
    id_prefix = pdf_path.name
    source_name = pdf_path.name

    all_ids: List[str] = []
    all_texts: List[str] = []
    all_metas: List[Dict[str, Any]] = []
    all_parent_ids: List[Optional[str]] = []
    all_page_starts: List[Optional[int]] = []
    all_page_ends: List[Optional[int]] = []
    all_block_types: List[Optional[str]] = []
    all_meta_jsons: List[Optional[str]] = []

    # Track per-(page, type) indices for unique chunk IDs
    page_text_counter: Dict[int, int] = {}
    page_table_counter: Dict[int, int] = {}
    page_image_counter: Dict[int, int] = {}

    for block in blocks:
        page = block.page

        if block.block_type == "text":
            # Parent-child chunking on text content
            t_idx = page_text_counter.get(page, 0)
            page_text_counter[page] = t_idx + 1
            ids, texts, metas, pids, pstarts, pends = _build_chunks_for_page(
                block.content, page, source_name,
                f"{id_prefix}-txt{t_idx}"
            )
            all_ids.extend(ids)
            all_texts.extend(texts)
            all_metas.extend(metas)
            all_parent_ids.extend(pids)
            all_page_starts.extend(pstarts)
            all_page_ends.extend(pends)
            all_block_types.extend(["text"] * len(ids))
            all_meta_jsons.extend([None] * len(ids))

        elif block.block_type == "table":
            if not block.content.strip():
                continue

            tbl_idx = page_table_counter.get(page, 0)
            page_table_counter[page] = tbl_idx + 1
            chunk_id = f"{id_prefix}-p{page}-tbl{tbl_idx}"

            # Store in tables table
            try:
                _insert_table(
                    doc_id, page,
                    block.table_markdown or block.content,
                    block.table_csv or "",
                    block.table_summary,
                    block.bbox,
                )
            except Exception as e:
                print(f"  _insert_table error: {e}", flush=True)

            all_ids.append(chunk_id)
            all_texts.append(block.content)
            all_metas.append({
                "source": source_name,
                "page": page,
                "chunk_id": tbl_idx,
                "block_type": "table",
            })
            all_parent_ids.append(None)
            all_page_starts.append(page)
            all_page_ends.append(page)
            all_block_types.append("table")
            all_meta_jsons.append(
                json.dumps({"table_markdown": block.table_markdown or ""})
            )

        elif block.block_type == "image":
            img_idx = page_image_counter.get(page, 0)
            page_image_counter[page] = img_idx + 1

            # Store in images table
            try:
                _insert_image(
                    doc_id, page,
                    block.image_path or "",
                    block.content or None,
                    block.bbox,
                )
            except Exception as e:
                print(f"  _insert_image error: {e}", flush=True)

            # Only create a searchable chunk if there's a caption
            if not block.content:
                continue

            chunk_id = f"{id_prefix}-p{page}-img{img_idx}"
            all_ids.append(chunk_id)
            all_texts.append(block.content)
            all_metas.append({
                "source": source_name,
                "page": page,
                "chunk_id": img_idx,
                "block_type": "image",
            })
            all_parent_ids.append(None)
            all_page_starts.append(page)
            all_page_ends.append(page)
            all_block_types.append("image")
            all_meta_jsons.append(
                json.dumps({"image_path": block.image_path or ""})
            )

    if not all_texts:
        print(f"Warning: {pdf_path.name} structured extraction yielded no text chunks.", flush=True)
        return 0

    try:
        embeddings = _compute_embeddings(all_texts)
    except Exception as e:
        print(f"Embedding failed for {pdf_path}: {e}", flush=True)
        return 0

    try:
        store.upsert(
            all_ids, all_texts, all_metas, embeddings,
            parent_ids=all_parent_ids,
            page_starts=all_page_starts,
            page_ends=all_page_ends,
            block_types=all_block_types,
            metadata_jsons=all_meta_jsons,
        )
    except Exception as e:
        print(f"Store upsert failed for {pdf_path}: {e}", flush=True)
        return 0

    return len(all_texts)


def ingest_txt(txt_path: Path, store: VectorStore) -> int:
    print(f"处理 TXT：{txt_path.name}", flush=True)
    try:
        full_text = _read_txt(txt_path)
    except Exception as e:
        print(f"Error reading {txt_path}: {e}", flush=True)
        return 0

    page_number = _extract_page_number_from_text(full_text)
    if page_number is None:
        page_number = _extract_page_number_from_filename(txt_path) or 1

    content_text = _strip_page_header(full_text)
    source_name  = _txt_source_name(txt_path)
    id_prefix    = source_name.replace("/", "__")

    ids, texts, metas, parent_ids, page_starts, page_ends = _build_chunks_for_page(
        content_text, page_number, source_name, id_prefix
    )

    if not texts:
        print(f"Warning: {txt_path.name} 没有可用内容", flush=True)
        return 0

    print(f"  chunks: {len(texts)}", flush=True)

    try:
        embeddings = _compute_embeddings(texts)
    except Exception as e:
        print(f"Embedding failed for {txt_path}: {e}", flush=True)
        return 0

    try:
        store.upsert(
            ids, texts, metas, embeddings,
            parent_ids=parent_ids,
            page_starts=page_starts,
            page_ends=page_ends,
        )
    except Exception as e:
        print(f"Store upsert failed for {txt_path}: {e}", flush=True)
        return 0

    return len(texts)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def ingest_all_pdfs(drop_existing: bool = False) -> Tuple[int, int]:
    knowledge_dir = Path(settings.knowledge_path)
    if not knowledge_dir.exists():
        raise RuntimeError(
            f"知识库目录不存在：{knowledge_dir}. 请在该目录下放置 PDF 或 TXT 文件。"
        )

    store_dir = Path(settings.chroma_persist_directory)
    if drop_existing and store_dir.exists():
        try:
            shutil.rmtree(store_dir)
            print("已清空原有向量存储。", flush=True)
        except Exception as e:
            print(f"Warning: 清空向量存储失败 ({e})，请手动删除：{store_dir}", flush=True)

    store = VectorStore(str(_store_path()))

    pdf_files = sorted(knowledge_dir.glob("**/*.pdf"))
    txt_files = sorted(knowledge_dir.glob("**/*.txt"))
    total_files = len(pdf_files) + len(txt_files)
    print(f"发现 {len(pdf_files)} 个 PDF，{len(txt_files)} 个 TXT，共 {total_files} 个文件", flush=True)

    total_chunks = 0
    total_docs   = 0
    processed    = 0

    for pdf_path in pdf_files:
        processed += 1
        print(f"[{processed}/{total_files}]", end=" ", flush=True)
        try:
            count = ingest_pdf(pdf_path, store)
            total_chunks += count
            if count > 0:
                total_docs += 1
        except BaseException as e:
            print(f"Error processing {pdf_path}: {e}", flush=True)

    for txt_path in txt_files:
        processed += 1
        print(f"[{processed}/{total_files}]", end=" ", flush=True)
        try:
            count = ingest_txt(txt_path, store)
            total_chunks += count
            if count > 0:
                total_docs += 1
        except BaseException as e:
            print(f"Error processing {txt_path}: {e}", flush=True)

    print(f"Total chunks: {total_chunks}", flush=True)
    return total_docs, total_chunks


# ---------------------------------------------------------------------------
# Legacy search (kept for backward compat; app.py now uses hybrid_search)
# ---------------------------------------------------------------------------

def search(query: str, top_k: int) -> List[Dict[str, Any]]:
    store = _get_store()
    count = store.count()

    if count == 0:
        print("Warning: 检索库为空，请先运行: python ingest.py", flush=True)
        return []

    query_embedding = _compute_embeddings([query])
    actual_top_k    = min(top_k, count)

    result = store.query(
        query_embeddings=query_embedding,
        n_results=actual_top_k,
        include=["documents", "metadatas", "distances"],
    )

    documents = result.get("documents", [])
    metadatas = result.get("metadatas", [])
    distances = result.get("distances", [])

    if not documents or not documents[0]:
        return []

    hits = []
    for idx, doc in enumerate(documents[0]):
        meta = metadatas[0][idx] if metadatas[0][idx] else {}
        hits.append({
            "content":    doc,
            "source":     meta.get("source", "unknown"),
            "page":       meta.get("page", -1),
            "score":      float(distances[0][idx]) if distances and distances[0] else 0.0,
        })
    return hits


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = __import__("argparse").ArgumentParser(
        description="将 rag-service/knowledge/ 中的 PDF/TXT 文档入库到向量数据库。"
    )
    parser.add_argument(
        "--drop",
        action="store_true",
        help="危险操作：删除现有检索库后全量重建。首次部署或普通更新不需要此参数。",
    )
    args = parser.parse_args()

    print("开始文档入库...", flush=True)
    docs, chunks = ingest_all_pdfs(drop_existing=args.drop)
    print(f"完成：共处理 {docs} 个文档，生成 {chunks} 个向量片段。", flush=True)


if __name__ == "__main__":
    main()
