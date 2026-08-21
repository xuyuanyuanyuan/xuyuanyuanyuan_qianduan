"""
Hybrid retrieval: BM25 (FTS5 or rank-bm25) + Vector (numpy cosine) + RRF fusion.

Import contract:
  - `ingest` module is the single source of truth for the SQLite path (_store_path)
    and the cache-invalidation counter (_embed_cache_version).
  - This module never imports from retrieval.reranker at module level; the
    import is deferred inside hybrid_search() to avoid circular issues.
"""
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# Embedding cache (avoids full-table SQL read on every query)
# ---------------------------------------------------------------------------

_cache_lock   = threading.Lock()
_embed_cache: Optional[Dict[str, Any]] = None
_local_cache_version: int = -1


def _get_db_path() -> Path:
    from ingest import _store_path
    return _store_path()


def _get_conn() -> sqlite3.Connection:
    return sqlite3.connect(str(_get_db_path()))


def _load_embed_cache() -> Dict[str, Any]:
    global _embed_cache, _local_cache_version

    import ingest as _ingest_mod
    current_version = _ingest_mod._embed_cache_version

    with _cache_lock:
        if _embed_cache is not None and _local_cache_version == current_version:
            return _embed_cache

        conn = _get_conn()
        try:
            rows = conn.execute(
                "SELECT id, document, metadata, embedding "
                "FROM chunks WHERE embedding IS NOT NULL AND embedding != ''"
            ).fetchall()
        finally:
            conn.close()

        if not rows:
            _embed_cache = {"ids": [], "docs": [], "metas": [], "matrix": None}
        else:
            ids   = [r[0] for r in rows]
            docs  = [r[1] for r in rows]
            metas = [json.loads(r[2]) if r[2] else {} for r in rows]
            raw   = np.array([json.loads(r[3]) for r in rows], dtype=np.float32)
            norms = np.linalg.norm(raw, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            matrix = raw / norms  # pre-normalised for cosine dot-product
            _embed_cache = {"ids": ids, "docs": docs, "metas": metas, "matrix": matrix}

        _local_cache_version = current_version
        return _embed_cache


# ---------------------------------------------------------------------------
# FTS5 availability check (cached per process)
# ---------------------------------------------------------------------------

_fts5_checked: Optional[bool] = None


def _fts5_available() -> bool:
    global _fts5_checked
    if _fts5_checked is not None:
        return _fts5_checked
    try:
        conn = _get_conn()
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
        ).fetchone()
        conn.close()
        _fts5_checked = row is not None
    except Exception:
        _fts5_checked = False
    return _fts5_checked


# ---------------------------------------------------------------------------
# BM25 search (FTS5 or rank-bm25 fallback)
# ---------------------------------------------------------------------------

def bm25_search(query: str, top_k: int = 50) -> List[Tuple[str, float]]:
    if _fts5_available():
        return _bm25_fts5(query, top_k)
    return _bm25_rank_bm25(query, top_k)


def _bm25_fts5(query: str, top_k: int) -> List[Tuple[str, float]]:
    try:
        conn = _get_conn()
        import re as _re

        # FTS5 treats whitespace-separated terms as an implicit AND. Agent
        # search queries deliberately contain the original question plus many
        # expansion terms, so passing the raw string made normal Chinese
        # questions match zero rows. Build a bounded OR query instead. Prefix
        # matching also handles longer CJK tokens produced by unicode61.
        stop_phrases = _re.compile(
            r"详细介绍|请介绍|请说明|需要注意什么|有什么影响|有哪些|是什么|"
            r"怎么做|如何|为什么|需要|注意事项|注意|什么|的|和|及|对"
        )
        raw_terms = _re.findall(r"[A-Za-z0-9][A-Za-z0-9_-]+|[\u4e00-\u9fff]{2,}", query)
        terms: List[str] = []

        for raw_term in raw_terms:
            pieces = [piece for piece in stop_phrases.split(raw_term) if len(piece) >= 2]
            for piece in pieces:
                terms.append(piece)
                if _re.fullmatch(r"[\u4e00-\u9fff]{4,8}", piece):
                    terms.extend(piece[index : index + 2] for index in range(len(piece) - 1))

        unique_terms = list(dict.fromkeys(terms))[:32]
        fts_query = " OR ".join(f'"{term}"*' for term in unique_terms)
        if not fts_query:
            conn.close()
            return []

        rows = conn.execute(
            'SELECT chunk_id, bm25(chunks_fts) '
            'FROM chunks_fts WHERE content MATCH ? '
            'ORDER BY bm25(chunks_fts) LIMIT ?',
            (fts_query, top_k),
        ).fetchall()
        conn.close()
        # bm25() returns negative values; negate so higher = better.
        return [(r[0], -r[1]) for r in rows]
    except Exception as e:
        print(f"FTS5 search error ({e}), falling back to rank-bm25.")
        return _bm25_rank_bm25(query, top_k)


def _bm25_rank_bm25(query: str, top_k: int) -> List[Tuple[str, float]]:
    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        print("rank-bm25 not installed and FTS5 unavailable — BM25 leg disabled.")
        return []

    conn = _get_conn()
    rows = conn.execute("SELECT id, document FROM chunks").fetchall()
    conn.close()

    if not rows:
        return []

    ids       = [r[0] for r in rows]
    tokenized = [list(r[1]) for r in rows]  # character-level for CJK
    bm25      = BM25Okapi(tokenized)
    scores    = bm25.get_scores(list(query))
    top_idx   = np.argsort(scores)[::-1][:top_k]
    return [(ids[i], float(scores[i])) for i in top_idx if scores[i] > 0]


# ---------------------------------------------------------------------------
# Vector search (numpy cosine, in-memory cache)
# ---------------------------------------------------------------------------

def vector_search(
    query_embedding: List[float],
    top_k: int = 50,
) -> List[Tuple[str, float]]:
    cache = _load_embed_cache()
    if cache["matrix"] is None:
        return []

    q     = np.array(query_embedding, dtype=np.float32)
    q_norm = float(np.linalg.norm(q)) or 1.0
    q     = q / q_norm

    sims    = cache["matrix"] @ q
    actual_k = min(top_k, len(sims))
    top_idx  = np.argsort(sims)[::-1][:actual_k]
    ids      = cache["ids"]
    return [(ids[i], float(sims[i])) for i in top_idx]


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion
# ---------------------------------------------------------------------------

def rrf_fuse(
    bm25_results: List[Tuple[str, float]],
    vector_results: List[Tuple[str, float]],
    k: int = 60,
    top_n: int = 30,
) -> List[Tuple[str, float]]:
    scores: Dict[str, float] = {}

    for rank, (chunk_id, _) in enumerate(bm25_results):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)

    for rank, (chunk_id, _) in enumerate(vector_results):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_n]


# ---------------------------------------------------------------------------
# Chunk fetch helpers
# ---------------------------------------------------------------------------

def _fetch_chunks(chunk_ids: List[str]) -> List[Dict[str, Any]]:
    if not chunk_ids:
        return []

    conn         = _get_conn()
    placeholders = ",".join("?" * len(chunk_ids))
    rows         = conn.execute(
        f"SELECT id, document, metadata, parent_id, section_path, "
        f"page_start, page_end, block_type, metadata_json "
        f"FROM chunks WHERE id IN ({placeholders})",
        chunk_ids,
    ).fetchall()
    conn.close()

    by_id: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        meta      = json.loads(r[2]) if r[2] else {}
        meta_json = json.loads(r[8]) if r[8] else {}
        entry: Dict[str, Any] = {
            "chunk_id":     r[0],
            "content":      r[1],
            "source_file":  meta.get("source", "unknown"),
            "source":       meta.get("source", "unknown"),  # backward compat
            "page":         meta.get("page", -1),            # backward compat
            "parent_id":    r[3],
            "section_path": r[4] or "",
            "page_start":   r[5],
            "page_end":     r[6],
            "block_type":   r[7] or "text",
        }
        # Merge extra metadata (image_path, table_markdown, etc.)
        entry.update(meta_json)
        by_id[r[0]] = entry

    # Preserve the order of chunk_ids
    return [by_id[cid] for cid in chunk_ids if cid in by_id]


def _expand_to_parents(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Replace child chunks with their parent chunk content for wider context."""
    parent_ids = [c["parent_id"] for c in chunks if c.get("parent_id")]
    parents    = (
        {p["chunk_id"]: p for p in _fetch_chunks(parent_ids)}
        if parent_ids else {}
    )

    result: List[Dict[str, Any]] = []
    seen: set = set()

    for chunk in chunks:
        pid = chunk.get("parent_id")
        represent_id = pid if (pid and pid in parents) else chunk["chunk_id"]

        if represent_id in seen:
            continue
        seen.add(represent_id)

        if pid and pid in parents:
            expanded = dict(parents[pid])
            expanded["score"]          = chunk.get("score", 0.0)
            expanded["child_chunk_id"] = chunk["chunk_id"]
            result.append(expanded)
        else:
            result.append(chunk)

    return result


# ---------------------------------------------------------------------------
# Search log
# ---------------------------------------------------------------------------

def _log_search(
    query: str,
    retrieved_ids: List[str],
    final_ids: List[str],
    latency_ms: int,
) -> None:
    try:
        conn = _get_conn()
        row  = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='search_logs'"
        ).fetchone()
        if row:
            conn.execute(
                "INSERT INTO search_logs (query, retrieved_ids, final_ids, latency_ms) "
                "VALUES (?,?,?,?)",
                (query, json.dumps(retrieved_ids), json.dumps(final_ids), latency_ms),
            )
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"search_logs write error: {e}")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def hybrid_search(
    query: str,
    query_embedding: List[float],
    top_k: int = 8,
) -> List[Dict[str, Any]]:
    from config import settings
    from retrieval.reranker import rerank

    t0 = time.monotonic()

    # BM25 + vector in parallel (threads share GIL but BM25 and numpy release it)
    bm25_result:   List[Tuple[str, float]] = []
    vector_result: List[Tuple[str, float]] = []

    def _run_bm25():
        nonlocal bm25_result
        bm25_result = bm25_search(query, settings.bm25_top_k)

    def _run_vector():
        nonlocal vector_result
        # simple_hash is a deterministic offline fallback, not a semantic
        # embedding model. Its cosine ranking is effectively random, so do not
        # let it dilute the BM25 results. A real OpenAI-compatible embedding
        # keeps the vector leg enabled.
        provider = (settings.embedding_provider or "").strip().lower()
        if provider not in {"simple_hash", "hash"}:
            vector_result = vector_search(query_embedding, settings.vector_top_k)

    t_bm25   = threading.Thread(target=_run_bm25,   daemon=True)
    t_vector = threading.Thread(target=_run_vector, daemon=True)
    t_bm25.start()
    t_vector.start()
    t_bm25.join()
    t_vector.join()

    # RRF fusion → top-N
    fused        = rrf_fuse(bm25_result, vector_result, k=settings.rrf_k, top_n=settings.rrf_top_n)
    fused_ids    = [cid for cid, _ in fused]
    fused_scores = {cid: score for cid, score in fused}

    # Fetch chunk content
    chunks = _fetch_chunks(fused_ids)
    for c in chunks:
        c["score"] = fused_scores.get(c["chunk_id"], 0.0)

    # Rerank (or fast-path truncate when reranker_provider='none')
    chunks = rerank(query, chunks, top_k=top_k)

    # Expand children → parents for wider context
    chunks = _expand_to_parents(chunks)

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    _log_search(query, fused_ids, [c["chunk_id"] for c in chunks], elapsed_ms)
    print(
        f"hybrid_search: bm25={len(bm25_result)} vector={len(vector_result)} "
        f"fused={len(fused_ids)} final={len(chunks)} latency={elapsed_ms}ms",
        flush=True,
    )

    return chunks
