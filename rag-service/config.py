import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _env(key: str, default: str | None = None) -> str | None:
    value = os.getenv(key)
    return value.strip() if isinstance(value, str) and value.strip() != "" else default


def _resolve_path(value: str | None, default: str) -> Path:
    path = Path(value if value is not None else default)
    return path if path.is_absolute() else (ROOT_DIR / path)


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
    embedding_provider: str = _env("EMBEDDING_PROVIDER", "openai_compatible")
    openai_api_key: str = _env("OPENAI_API_KEY", "")
    openai_base_url: str = _env("OPENAI_BASE_URL", "")
    openai_embedding_model: str = _env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    local_embedding_model: str = _env("LOCAL_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    default_top_k: int = int(_env("RAG_DEFAULT_TOP_K", "3"))
    ocr_output_dir: Path = _resolve_path(
        _env("OCR_OUTPUT_DIR"),
        "./rag-service/knowledge/ocr_book",
    )
    ocr_default_start_page: int = int(_env("OCR_DEFAULT_START_PAGE", "1"))
    ocr_default_end_page: int = int(_env("OCR_DEFAULT_END_PAGE", "50"))
    ocr_language: str = _env("OCR_LANGUAGE", "ch")
    ocr_zoom: float = float(_env("OCR_ZOOM", "2.0"))


settings = Settings()
