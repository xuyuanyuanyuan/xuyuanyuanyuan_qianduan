from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from ingest import _compute_embeddings, _get_store, _store_path
from retrieval.hybrid_search import hybrid_search
from tables import QueryEngine, TableIngestor, TableRegistry


def _safe_console_text(value: str) -> str:
    encoding = "utf-8"
    try:
        import sys
        encoding = sys.stdout.encoding or "utf-8"
    except Exception:
        pass
    return value.encode(encoding, errors="replace").decode(encoding, errors="replace")


table_registry = TableRegistry()
table_ingestor = TableIngestor(table_registry)
table_query_engine = QueryEngine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    _get_store()
    print("VectorStore initialised (schema up to date).", flush=True)
    yield


app = FastAPI(
    title="RAG & Table Service",
    description="九工天匠混合检索与表格分析计算服务",
    version="0.3.0",
    lifespan=lifespan,
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


@app.get("/health")
async def health() -> Dict[str, Any]:
    store = _get_store()
    return {
        "status":         "ok",
        "storage":        str(Path(settings.chroma_persist_directory).resolve()),
        "database":       str(_store_path().resolve()),
        "knowledge":      str(Path(settings.knowledge_path).resolve()),
        "chunks":         str(store.count()),
        "table_datasets": str(table_registry.count()),
    }


# ==================== RAG Knowledge Endpoints ====================

@app.post("/search")
async def search(request: Request) -> JSONResponse:
    body = await request.json()
    query = body.get("query")
    top_k = int(body.get("top_k", settings.default_top_k))

    if not isinstance(query, str) or not query.strip():
        raise HTTPException(status_code=400, detail="query 字段不能为空。")

    query = query.strip()
    print(f"Query: {_safe_console_text(query)}, top_k: {top_k}", flush=True)

    try:
        store = _get_store()
        if store.count() == 0:
            print("Warning: 检索库为空，请先运行: python ingest.py", flush=True)
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


# ==================== Table QA & Ingestion Endpoints ====================

@app.post("/tables/upload")
async def upload_table(
    file: UploadFile = File(...),
    description: str = Form(default=""),
    project_name: str | None = Form(default=None),
) -> JSONResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".xlsx", ".xlsm", ".xls", ".csv"}:
        raise HTTPException(
            status_code=400,
            detail="仅支持上传 .xlsx, .xlsm, .xls, .csv 格式的表格文件。",
        )

    stored_name = f"{uuid4().hex}{suffix}"
    stored_path = settings.table_upload_dir / stored_name
    stored_path.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    stored_path.write_bytes(content)

    try:
        dataset = table_ingestor.ingest(
            stored_path,
            original_filename=file.filename or stored_name,
            description=description,
            project_name=project_name,
        )
        return JSONResponse(content={"status": "ok", "dataset": dataset})
    except Exception as error:
        if stored_path.exists():
            stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"表格解析入库失败：{error}")


@app.get("/tables/datasets")
async def list_table_datasets() -> JSONResponse:
    datasets = table_registry.list()
    return JSONResponse(content={"datasets": datasets})


@app.get("/tables/datasets/{dataset_id}")
async def get_table_dataset(dataset_id: str) -> JSONResponse:
    dataset = table_registry.get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="表格数据资产不存在。")
    return JSONResponse(content={"dataset": dataset})


@app.delete("/tables/datasets/{dataset_id}")
async def delete_table_dataset(dataset_id: str) -> JSONResponse:
    success = table_ingestor.delete_dataset(dataset_id)
    if not success:
        raise HTTPException(status_code=404, detail="未找到要删除的表格数据资产。")
    return JSONResponse(content={"status": "ok", "deleted_dataset_id": dataset_id})


@app.post("/tables/query")
async def query_table_sql(request: Request) -> JSONResponse:
    body = await request.json()
    sql = body.get("sql")
    limit = int(body.get("limit", 200))

    if not isinstance(sql, str) or not sql.strip():
        raise HTTPException(status_code=400, detail="sql 字段不能为空。")

    try:
        result = table_query_engine.run_select(sql, limit=limit)
        return JSONResponse(content=result)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"SQL 执行失败：{error}")


@app.post("/tables/preview")
async def preview_table_sheet(request: Request) -> JSONResponse:
    body = await request.json()
    dataset_id = body.get("dataset_id")
    sheet_id = body.get("sheet_id")
    limit = int(body.get("limit", 20))

    if not dataset_id or not sheet_id:
        raise HTTPException(status_code=400, detail="缺少 dataset_id 或 sheet_id。")

    dataset = table_registry.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="表格数据资产不存在。")

    sheet = next((s for s in dataset.get("sheets", []) if s.get("sheet_id") == sheet_id), None)
    if not sheet:
        raise HTTPException(status_code=404, detail="Sheet 不存在。")

    table_name = sheet.get("table_name")
    result = table_query_engine.preview_table(table_name, limit=limit)
    return JSONResponse(content=result)


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=settings.rag_service_port,
        reload=False,
    )
