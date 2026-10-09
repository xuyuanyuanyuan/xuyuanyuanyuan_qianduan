"""Table HTTP routes, separated from RAG/model startup for offline regression."""

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from config import settings
from tables import QueryEngine, TableIngestor, TableRegistry


def create_table_router(
    table_registry: TableRegistry,
    table_ingestor: TableIngestor,
    table_query_engine: QueryEngine,
) -> APIRouter:
    router = APIRouter()

    async def json_object(request: Request) -> dict:
        try:
            body = await request.json()
        except ValueError as error:
            raise HTTPException(status_code=400, detail="请求必须包含有效 JSON。") from error
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="请求 JSON 必须为对象。")
        return body

    # ==================== Table QA & Ingestion Endpoints ====================

    @router.post("/tables/upload")
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


    @router.get("/tables/datasets")
    async def list_table_datasets() -> JSONResponse:
        datasets = table_registry.list()
        return JSONResponse(content={"datasets": datasets})


    @router.get("/tables/datasets/{dataset_id}")
    async def get_table_dataset(dataset_id: str) -> JSONResponse:
        dataset = table_registry.get(dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="表格数据资产不存在。")
        return JSONResponse(content={"dataset": dataset})


    @router.delete("/tables/datasets/{dataset_id}")
    async def delete_table_dataset(dataset_id: str) -> JSONResponse:
        success = table_ingestor.delete_dataset(dataset_id)
        if not success:
            raise HTTPException(status_code=404, detail="未找到要删除的表格数据资产。")
        return JSONResponse(content={"status": "ok", "deleted_dataset_id": dataset_id})


    @router.post("/tables/query")
    async def query_table_sql(request: Request) -> JSONResponse:
        body = await json_object(request)
        try:
            result = table_query_engine.run_select(
                body.get("sql"), limit=body.get("limit", 200), dataset_ids=body.get("dataset_ids")
            )
            return JSONResponse(content=result)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"SQL 执行失败：{error}")


    @router.post("/tables/preview")
    async def preview_table_sheet(request: Request) -> JSONResponse:
        body = await json_object(request)
        dataset_id = body.get("dataset_id")
        sheet_id = body.get("sheet_id")
        if not isinstance(dataset_id, str) or not dataset_id.strip() or not isinstance(sheet_id, str) or not sheet_id.strip():
            raise HTTPException(status_code=400, detail="缺少 dataset_id 或 sheet_id。")

        dataset = table_registry.get(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="表格数据资产不存在。")

        sheet = next((s for s in dataset.get("sheets", []) if s.get("sheet_id") == sheet_id), None)
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet 不存在。")

        table_name = sheet.get("table_name")
        try:
            result = table_query_engine.preview_table(table_name, limit=body.get("limit", 20))
            return JSONResponse(content=result)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"SQL 执行失败：{error}") from error

    return router
