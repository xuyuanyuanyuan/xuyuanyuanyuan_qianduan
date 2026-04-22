from pathlib import Path
from typing import Any, Dict, List

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from config import settings
from ingest import search as rag_search


def _safe_console_text(value: str) -> str:
    encoding = 'utf-8'
    try:
        import sys
        encoding = sys.stdout.encoding or 'utf-8'
    except Exception:
        pass
    return value.encode(encoding, errors='replace').decode(encoding, errors='replace')

app = FastAPI(
    title="RAG Service",
    description="基于 Chroma 的本地 RAG 检索服务",
    version="0.1.0",
)


class SearchResponse(JSONResponse):
    def __init__(self, results: List[Dict[str, Any]]):
        super().__init__(content={"results": results}, status_code=200)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {
        "status": "ok",
        "storage": str(Path(settings.chroma_persist_directory).resolve()),
        "knowledge": str(Path(settings.knowledge_path).resolve()),
    }


@app.post("/search")
async def search(request: Request) -> JSONResponse:
    body = await request.json()
    query = body.get("query")
    top_k = int(body.get("top_k", settings.default_top_k))

    if not isinstance(query, str) or not query.strip():
        raise HTTPException(status_code=400, detail="query 字段不能为空。")

    print(f"Query: {_safe_console_text(query)}, top_k: {top_k}")
    try:
        results = rag_search(query.strip(), top_k)
        print(f"Results count: {len(results)}")
        if not results:
            print("Warning: No results found, vector_store may be empty")
    except Exception as error:
        print(f"Search error: {error}")
        raise HTTPException(status_code=500, detail=f"检索服务异常：{error}")

    return SearchResponse(results=results)


@app.get("/search")
async def search_get(query: str, top_k: int = settings.default_top_k) -> SearchResponse:
    if not query.strip():
        raise HTTPException(status_code=400, detail="query 字段不能为空。")
    results = rag_search(query.strip(), top_k)
    return SearchResponse(results=results)


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=settings.rag_service_port,
        reload=False,
    )
