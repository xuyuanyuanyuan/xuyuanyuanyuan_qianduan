"""
Phase 1 evaluation: compare legacy vector-only search vs. new hybrid search.

Usage (from rag-service/ directory):
    python eval/phase1_compare.py                      # compare both paths
    python eval/phase1_compare.py --mode legacy        # legacy only
    python eval/phase1_compare.py --mode hybrid        # hybrid only
    python eval/phase1_compare.py --top-k 5            # top-k per query
    python eval/phase1_compare.py --url http://host:3001  # remote service

The script calls both search paths directly (no HTTP) for speed.
Set --url to test against a running server instead.
"""
import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ---------------------------------------------------------------------------
# Test queries — replace / extend with domain-specific questions
# ---------------------------------------------------------------------------
TEST_QUERIES = [
    "桩基础施工规范",
    "钻孔灌注桩施工工艺",
    "混凝土配合比设计",
    "钢筋笼制作要求",
    "桩基检测方法",
    "地基处理技术",
    "沉桩施工注意事项",
    "桩顶标高控制",
    "护筒埋设要求",
    "泥浆护壁技术",
    "水下混凝土浇筑",
    "桩身完整性检测",
    "承载力检测",
    "静载试验",
    "动测法检测",
    "施工质量验收",
    "安全文明施工",
    "环境保护措施",
    "桩基工程记录",
    "桩基施工方案",
]


# ---------------------------------------------------------------------------
# Direct (in-process) search functions
# ---------------------------------------------------------------------------

def _legacy_search(query: str, top_k: int) -> List[Dict[str, Any]]:
    from ingest import search as legacy_search_fn
    return legacy_search_fn(query, top_k)


def _hybrid_search_direct(query: str, top_k: int) -> List[Dict[str, Any]]:
    from ingest import _compute_embeddings
    from retrieval.hybrid_search import hybrid_search
    emb = _compute_embeddings([query])[0]
    return hybrid_search(query, emb, top_k=top_k)


# ---------------------------------------------------------------------------
# HTTP search (against a running service)
# ---------------------------------------------------------------------------

def _http_search(base_url: str, query: str, top_k: int) -> List[Dict[str, Any]]:
    import urllib.request
    payload = json.dumps({"query": query, "top_k": top_k}).encode()
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data.get("results", [])


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def _fmt_result(r: Dict[str, Any], rank: int) -> str:
    source = r.get("source_file") or r.get("source", "?")
    page   = r.get("page_start") or r.get("page", "?")
    score  = r.get("score", 0.0)
    snip   = (r.get("content") or "")[:80].replace("\n", " ")
    return f"  [{rank}] {source} p{page} score={score:.4f}  "{snip}…""


def _run_comparison(queries: List[str], top_k: int, url: Optional[str]) -> None:
    total = len(queries)
    latencies_legacy: List[float] = []
    latencies_hybrid: List[float] = []

    for i, query in enumerate(queries, 1):
        print(f"\n{'='*70}")
        print(f"[{i}/{total}] Query: {query}")
        print(f"{'='*70}")

        # --- Legacy ---
        t0 = time.monotonic()
        try:
            if url:
                # Legacy path not exposed separately via HTTP; skip
                legacy_results = []
                print("  [legacy] skipped (use direct mode without --url)")
            else:
                legacy_results = _legacy_search(query, top_k)
        except Exception as e:
            legacy_results = []
            print(f"  [legacy] ERROR: {e}")
        latency_legacy = time.monotonic() - t0
        latencies_legacy.append(latency_legacy)

        print(f"  [legacy] {len(legacy_results)} results  ({latency_legacy*1000:.0f}ms)")
        for j, r in enumerate(legacy_results[:top_k], 1):
            print(_fmt_result(r, j))

        # --- Hybrid ---
        t0 = time.monotonic()
        try:
            if url:
                hybrid_results = _http_search(url, query, top_k)
            else:
                hybrid_results = _hybrid_search_direct(query, top_k)
        except Exception as e:
            hybrid_results = []
            print(f"  [hybrid] ERROR: {e}")
        latency_hybrid = time.monotonic() - t0
        latencies_hybrid.append(latency_hybrid)

        print(f"  [hybrid] {len(hybrid_results)} results  ({latency_hybrid*1000:.0f}ms)")
        for j, r in enumerate(hybrid_results[:top_k], 1):
            print(_fmt_result(r, j))

    # Summary
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    if latencies_legacy:
        p95_legacy = sorted(latencies_legacy)[int(len(latencies_legacy) * 0.95)]
        print(f"Legacy  — avg: {sum(latencies_legacy)/len(latencies_legacy)*1000:.0f}ms  P95: {p95_legacy*1000:.0f}ms")
    if latencies_hybrid:
        p95_hybrid = sorted(latencies_hybrid)[int(len(latencies_hybrid) * 0.95)]
        print(f"Hybrid  — avg: {sum(latencies_hybrid)/len(latencies_hybrid)*1000:.0f}ms  P95: {p95_hybrid*1000:.0f}ms")
    print(f"Queries : {total}")


def _run_single_mode(mode: str, queries: List[str], top_k: int, url: Optional[str]) -> None:
    for i, query in enumerate(queries, 1):
        print(f"\n[{i}/{len(queries)}] {query}")
        t0 = time.monotonic()
        try:
            if mode == "legacy":
                results = _legacy_search(query, top_k)
            else:
                if url:
                    results = _http_search(url, query, top_k)
                else:
                    results = _hybrid_search_direct(query, top_k)
        except Exception as e:
            print(f"  ERROR: {e}")
            continue
        latency = (time.monotonic() - t0) * 1000
        print(f"  {len(results)} results  ({latency:.0f}ms)")
        for j, r in enumerate(results[:top_k], 1):
            print(_fmt_result(r, j))


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 1 hybrid search evaluation")
    parser.add_argument(
        "--mode",
        choices=["compare", "legacy", "hybrid"],
        default="compare",
        help="compare (default): side-by-side; legacy/hybrid: single mode",
    )
    parser.add_argument("--top-k", type=int, default=5, dest="top_k")
    parser.add_argument(
        "--url",
        default=None,
        help="Run hybrid search against a running service (e.g. http://localhost:3001)",
    )
    parser.add_argument(
        "--queries",
        nargs="*",
        help="Override test queries (space-separated). Use quotes for phrases.",
    )
    args = parser.parse_args()

    queries = args.queries if args.queries else TEST_QUERIES

    if args.mode == "compare":
        _run_comparison(queries, args.top_k, args.url)
    else:
        _run_single_mode(args.mode, queries, args.top_k, args.url)


if __name__ == "__main__":
    main()
