from pathlib import Path
from typing import Dict

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from ingest import _compute_embeddings, _get_store
from retrieval.hybrid_search import hybrid_search


def _safe_console_text(value: str) -> str:
    encoding = "utf-8"
    try:
        import sys
        encoding = sys.stdout.encoding or "utf-8"
    except Exception:
        pass
    return value.encode(encoding, errors="replace").decode(encoding, errors="replace")


app = FastAPI(
    title="RAG Service",
    description="Hybrid-search RAG 检索服务 (BM25 + Vector + RRF + Rerank)",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve extracted PDF images at /static/images/
_static_images_dir = settings.static_dir / "images"
_static_images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")

# Warm up: initialise the store (runs _init_db migration) at startup.
@app.on_event("startup")
async def _startup() -> None:
    _get_store()
    print("VectorStore initialised (schema up to date).", flush=True)


@app.get("/health")
async def health() -> Dict[str, str]:
    store = _get_store()
    return {
        "status":    "ok",
        "storage":   str(Path(settings.chroma_persist_directory).resolve()),
        "knowledge": str(Path(settings.knowledge_path).resolve()),
        "chunks":    str(store.count()),
    }


@app.post("/search")
async def search(request: Request) -> JSONResponse:
    body  = await request.json()
    query = body.get("query")
    top_k = int(body.get("top_k", settings.default_top_k))

    if not isinstance(query, str) or not query.strip():
        raise HTTPException(status_code=400, detail="query 字段不能为空。")

    query = query.strip()
    print(f"Query: {_safe_console_text(query)}, top_k: {top_k}", flush=True)

    try:
        store = _get_store()
        if store.count() == 0:
            print("Warning: 向量库为空，请先运行: python ingest.py --drop", flush=True)
            return JSONResponse(content={"query": query, "results": []})

        query_embedding = _compute_embeddings([query])[0]
        results = hybrid_search(query, query_embedding, top_k=top_k)

        print(f"Results count: {len(results)}", flush=True)
    except Exception as error:
        print(f"Search error: {error}", flush=True)
        raise HTTPException(status_code=500, detail=f"检索服务异常：{error}")

    return JSONResponse(content={"query": query, "results": results})


@app.get("/search")
async def search_get(query: str, top_k: int = settings.default_top_k) -> JSONResponse:
    if not query.strip():
        raise HTTPException(status_code=400, detail="query 字段不能为空。")

    query = query.strip()
    store = _get_store()
    if store.count() == 0:
        return JSONResponse(content={"query": query, "results": []})

    query_embedding = _compute_embeddings([query])[0]
    results = hybrid_search(query, query_embedding, top_k=top_k)
    return JSONResponse(content={"query": query, "results": results})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=settings.rag_service_port,
        reload=False,
    )
