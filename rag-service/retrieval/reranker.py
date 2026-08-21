"""
Reranker module.

Current default: RERANKER_PROVIDER=none (RRF score ordering, no model inference).
Switch to cross_encoder once the server can download BAAI/bge-reranker-v2-m3,
or to jina if you have a Jina AI API key.
"""
import json
import threading
from typing import Any, Dict, List


def rerank(
    query: str,
    chunks: List[Dict[str, Any]],
    top_k: int = 8,
) -> List[Dict[str, Any]]:
    from config import settings

    provider = (settings.reranker_provider or "none").strip().lower()

    if provider == "none" or not chunks:
        return sorted(chunks, key=lambda c: c.get("score", 0.0), reverse=True)[:top_k]

    if provider == "cross_encoder":
        return _rerank_cross_encoder(query, chunks, top_k)

    if provider == "jina":
        return _rerank_jina(query, chunks, top_k)

    print(f"Unknown reranker_provider '{provider}', falling back to score sort.")
    return sorted(chunks, key=lambda c: c.get("score", 0.0), reverse=True)[:top_k]


# ---------------------------------------------------------------------------
# CrossEncoder (sentence-transformers)
# ---------------------------------------------------------------------------

_cross_encoder_model = None
_cross_encoder_lock  = threading.Lock()


def _get_cross_encoder():
    global _cross_encoder_model
    with _cross_encoder_lock:
        if _cross_encoder_model is None:
            from config import settings
            from sentence_transformers import CrossEncoder
            print(f"Loading CrossEncoder model: {settings.reranker_model}", flush=True)
            _cross_encoder_model = CrossEncoder(settings.reranker_model)
    return _cross_encoder_model


def _rerank_cross_encoder(
    query: str,
    chunks: List[Dict[str, Any]],
    top_k: int,
) -> List[Dict[str, Any]]:
    try:
        model  = _get_cross_encoder()
        pairs  = [(query, c["content"]) for c in chunks]
        scores = model.predict(pairs)
        for c, s in zip(chunks, scores):
            c["rerank_score"] = float(s)
        return sorted(chunks, key=lambda c: c.get("rerank_score", 0.0), reverse=True)[:top_k]
    except Exception as e:
        print(f"CrossEncoder rerank failed ({e}), falling back to RRF score.")
        return sorted(chunks, key=lambda c: c.get("score", 0.0), reverse=True)[:top_k]
# ---------------------------------------------------------------------------
# Jina Reranker API
# ---------------------------------------------------------------------------

def _rerank_jina(
    query: str,
    chunks: List[Dict[str, Any]],
    top_k: int,
) -> List[Dict[str, Any]]:
    from config import settings

    api_key = settings.jina_reranker_api_key
    if not api_key:
        print("Jina reranker API key not configured, falling back to RRF score.")
        return sorted(chunks, key=lambda c: c.get("score", 0.0), reverse=True)[:top_k]

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "model":     "jina-reranker-v2-base-multilingual",
            "query":     query,
            "documents": [c["content"] for c in chunks],
            "top_n":     top_k,
        }).encode()

        req = urllib.request.Request(
            "https://api.jina.ai/v1/rerank",
            data=payload,
            headers={
                "Authorization":  f"Bearer {api_key}",
                "Content-Type":   "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data    = json.loads(resp.read())
        results = data.get("results", [])
        ordered: List[Dict[str, Any]] = []
        for r in results:
            chunk = dict(chunks[r["index"]])
            chunk["rerank_score"] = r["relevance_score"]
            ordered.append(chunk)
        return ordered
    except Exception as e:
        print(f"Jina rerank failed ({e}), falling back to RRF score.")
        return sorted(chunks, key=lambda c: c.get("score", 0.0), reverse=True)[:top_k]
