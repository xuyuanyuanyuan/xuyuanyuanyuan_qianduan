import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

SERVICE_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVICE_DIR.parent

ROOT_ENV = dotenv_values(ROOT_DIR / ".env")
SERVICE_ENV = dotenv_values(SERVICE_DIR / ".env")


def _env(key: str, default: str | None = None) -> str | None:
    value = os.getenv(key) or SERVICE_ENV.get(key) or ROOT_ENV.get(key)
    return value.strip() if isinstance(value, str) and value.strip() != "" else default


def _resolve_path(value: str | None, default: str) -> Path:
    path = Path(value if value is not None else default)
    return path if path.is_absolute() else (ROOT_DIR / path)


def _env_bool(key: str, default: bool = True) -> bool:
    val = _env(key, "true" if default else "false")
    return (val or "").strip().lower() not in ("false", "0", "no")


@dataclass
class Settings:
    rag_service_port: int = int(_env("RAG_SERVICE_PORT", "3001"))
    chroma_persist_directory: Path = _resolve_path(
        _env("CHROMA_PERSIST_DIRECTORY"),
        "./rag-service/vector_store/chroma",
    )
    knowledge_path: Path = _resolve_path(
        _env("KNOWLEDGE_PATH"),
        "./rag-service/knowledge",
    )
    embedding_provider: str = _env("EMBEDDING_PROVIDER", "simple_hash")
    openai_api_key: str = _env("OPENAI_API_KEY", "")
    openai_base_url: str = _env("OPENAI_BASE_URL", "")
    openai_embedding_model: str = _env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    default_top_k: int = int(_env("RAG_DEFAULT_TOP_K", "3"))
    ocr_output_dir: Path = _resolve_path(
        _env("OCR_OUTPUT_DIR"),
        "./rag-service/knowledge/ocr_book",
    )
    ocr_default_start_page: int = int(_env("OCR_DEFAULT_START_PAGE", "1"))
    ocr_default_end_page: int = int(_env("OCR_DEFAULT_END_PAGE", "50"))
    ocr_language: str = _env("OCR_LANGUAGE", "ch")
    ocr_zoom: float = float(_env("OCR_ZOOM", "2.0"))

    # Phase 1: Hybrid Search
    bm25_top_k: int = int(_env("BM25_TOP_K", "50"))
    vector_top_k: int = int(_env("VECTOR_TOP_K", "50"))
    rrf_k: int = int(_env("RRF_K", "60"))
    rrf_top_n: int = int(_env("RRF_TOP_N", "30"))
    reranker_provider: str = _env("RERANKER_PROVIDER", "none")
    reranker_model: str = _env("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
    jina_reranker_api_key: str = _env("JINA_RERANKER_API_KEY", "") or ""

    # Phase 1: Parent-child chunking
    use_parent_child_chunking: bool = _env_bool("USE_PARENT_CHILD", True)
    parent_chunk_size: int = int(_env("PARENT_CHUNK_SIZE", "1000"))
    parent_chunk_overlap: int = int(_env("PARENT_CHUNK_OVERLAP", "100"))
    child_chunk_size: int = int(_env("CHILD_CHUNK_SIZE", "300"))
    child_chunk_overlap: int = int(_env("CHILD_CHUNK_OVERLAP", "50"))

    # Phase 2: Multimodal PDF parsing
    generate_table_summaries: bool = _env_bool("GENERATE_TABLE_SUMMARIES", True)
    generate_image_captions: bool = _env_bool("GENERATE_IMAGE_CAPTIONS", False)
    # LLM for table summaries / image captions (chat API, not embedding API)
    llm_api_key: str = _env("LLM_API_KEY", "") or ""
    llm_base_url: str = _env("LLM_BASE_URL", "") or ""
    llm_model: str = _env("LLM_MODEL", "deepseek-chat")
    image_caption_model: str = _env("IMAGE_CAPTION_MODEL", "deepseek-vl")
    # Scanned-PDF detection: if avg chars per page < this, treat as scanned → use OCR path
    min_text_chars_per_page: int = int(_env("MIN_TEXT_CHARS_PER_PAGE", "50"))
    # Directory for extracted images served over HTTP
    static_dir: Path = _resolve_path(_env("STATIC_DIR"), "./rag-service/static")

    # Table data storage
    table_data_dir: Path = _resolve_path(
        _env("TABLE_DATA_DIR"),
        "./rag-service/vector_store/tables",
    )
    warehouse_db: Path = _resolve_path(
        _env("WAREHOUSE_DB"),
        "./rag-service/vector_store/tables/warehouse.duckdb",
    )
    table_registry_db: Path = _resolve_path(
        _env("TABLE_REGISTRY_DB"),
        "./rag-service/vector_store/tables/registry.sqlite3",
    )
    table_upload_dir: Path = _resolve_path(
        _env("TABLE_UPLOAD_DIR"),
        "./rag-service/vector_store/tables/uploads",
    )


settings = Settings()

