import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import chromadb
import fitz
import openai
from chromadb.config import Settings as ChromaSettings

from config import settings


PAGE_HEADER_PATTERN = re.compile(r"^\s*\[PAGE\s+(\d+)\]\s*(?:\r?\n)?", re.IGNORECASE)
PAGE_FILENAME_PATTERN = re.compile(r"(?:^|[_-])page[_-]?(\d+)$", re.IGNORECASE)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _split_text(text: str, chunk_size: int = 650, overlap: int = 120) -> List[str]:
    clean = _normalize_text(text)
    if not clean:
        return []

    sentences = re.split(r"(?<=[。！？!?])\s*", clean)
    chunks = []
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
                current = current[chunk_size - overlap :]

    if current:
        chunks.append(current.strip())

    return chunks


def _create_openai_client() -> None:
    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY 未配置。请设置环境变量后重新运行。"
        )

    openai.api_key = settings.openai_api_key
    if settings.openai_base_url:
        openai.api_base = settings.openai_base_url


def _embedding_config_warning() -> Optional[str]:
    base_url = (settings.openai_base_url or "").strip().lower().rstrip("/")
    model = (settings.openai_embedding_model or "").strip()

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


def _compute_embeddings(texts: List[str]) -> List[List[float]]:
    provider = (settings.embedding_provider or "").strip().lower()

    if provider in {"simple_hash", "hash"}:
        print("Embedding provider: simple_hash")
        return _simple_embedding(texts)

    if provider == "openai_compatible":
        config_warning = _embedding_config_warning()
        if config_warning:
            print(f"Embedding config warning: {config_warning}")

        try:
            from openai import OpenAI

            client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
            response = client.embeddings.create(
                model=settings.openai_embedding_model,
                input=texts,
            )
            embeddings = [item.embedding for item in response.data]
            print(f"Embedding success: {len(embeddings)} texts")
            return embeddings
        except Exception as e:
            print(f"Embedding error: {e}, falling back to simple hash embedding")
            return _simple_embedding(texts)

    raise RuntimeError(
        "当前仅支持 openai_compatible 或 simple_hash 嵌入器。"
    )


def _simple_embedding(texts: List[str]) -> List[List[float]]:
    import hashlib

    embeddings = []
    for text in texts:
        hash_val = hashlib.md5(text.encode()).digest()
        embedding = [float(b) / 255.0 for b in hash_val[:16]]
        embeddings.append(embedding)
    return embeddings


def _create_chroma_client() -> chromadb.Client:
    persist_dir = Path(settings.chroma_persist_directory)
    persist_dir.mkdir(parents=True, exist_ok=True)
    return chromadb.Client(
        settings=ChromaSettings(
            chroma_api_impl="chromadb.api.rust.RustBindingsAPI",
            persist_directory=str(persist_dir),
            is_persistent=True,
        )
    )


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


def ingest_pdf(pdf_path: Path, collection_name: str = "knowledge") -> int:
    print(f"处理 PDF：{pdf_path}")
    texts: List[str] = []
    metadatas: List[Dict[str, Any]] = []
    ids: List[str] = []

    for page_number, page_text in _load_pdf_text(pdf_path):
        chunks = _split_text(page_text)
        for chunk_index, chunk in enumerate(chunks):
            fragment_id = f"{pdf_path.name}-{page_number}-{chunk_index}"
            ids.append(fragment_id)
            texts.append(chunk)
            metadatas.append(
                {
                    "source": pdf_path.name,
                    "page": page_number,
                    "chunk_id": chunk_index,
                }
            )

    if not texts:
        print(f"Warning: {pdf_path.name} 没有可提取的文本，可能是扫描版本，请使用OCR处理")
        return 0

    try:
        embeddings = _compute_embeddings(texts)
    except Exception as e:
        print(f"Embedding failed for {pdf_path}: {e}")
        return 0

    client = _create_chroma_client()
    collection = client.get_or_create_collection(name=collection_name)
    collection.upsert(
        ids=ids,
        documents=texts,
        metadatas=metadatas,
        embeddings=embeddings,
    )
    return len(texts)


def ingest_txt(txt_path: Path, collection_name: str = "knowledge") -> int:
    print(f"处理 TXT：{txt_path}")
    try:
        with open(txt_path, "r", encoding="utf-8") as f:
            full_text = f.read()
    except Exception as e:
        print(f"Error reading {txt_path}: {e}")
        return 0

    page_number = _extract_page_number_from_text(full_text)
    if page_number is None:
        page_number = _extract_page_number_from_filename(txt_path) or 1

    content_text = _strip_page_header(full_text)
    chunks = _split_text(content_text)
    if not chunks:
        print(f"Warning: {txt_path.name} 没有可用内容")
        return 0

    texts: List[str] = []
    metadatas: List[Dict[str, Any]] = []
    ids: List[str] = []
    source_name = _txt_source_name(txt_path)
    source_id_prefix = source_name.replace("/", "__")

    for chunk_index, chunk in enumerate(chunks):
        fragment_id = f"{source_id_prefix}-{page_number}-{chunk_index}"
        ids.append(fragment_id)
        texts.append(chunk)
        metadatas.append(
            {
                "source": source_name,
                "page": page_number,
                "chunk_id": chunk_index,
            }
        )

    print(f"Total chunks: {len(chunks)}")

    try:
        embeddings = _compute_embeddings(texts)
    except Exception as e:
        print(f"Embedding failed for {txt_path}: {e}")
        return 0

    client = _create_chroma_client()
    collection = client.get_or_create_collection(name=collection_name)
    collection.upsert(
        ids=ids,
        documents=texts,
        metadatas=metadatas,
        embeddings=embeddings,
    )
    return len(texts)


def ingest_all_pdfs(drop_existing: bool = False) -> Tuple[int, int]:
    knowledge_dir = Path(settings.knowledge_path)
    if not knowledge_dir.exists():
        raise RuntimeError(
            f"知识库目录不存在：{knowledge_dir}. 请在该目录下放置 PDF 或 TXT 文件。"
        )

    if drop_existing and Path(settings.chroma_persist_directory).exists():
        for child in Path(settings.chroma_persist_directory).glob("**/*"):
            if child.is_file():
                child.unlink()
        print("已清空原有 Chroma 向量存储。")

    pdf_files = sorted(knowledge_dir.glob("**/*.pdf"))
    txt_files = sorted(knowledge_dir.glob("**/*.txt"))
    total_chunks = 0
    total_docs = 0

    for pdf_path in pdf_files:
        count = ingest_pdf(pdf_path)
        total_chunks += count
        if count > 0:
            total_docs += 1

    for txt_path in txt_files:
        count = ingest_txt(txt_path)
        total_chunks += count
        if count > 0:
            total_docs += 1

    print(f"Total chunks: {total_chunks}")
    return total_docs, total_chunks


def search(query: str, top_k: int) -> List[Dict[str, Any]]:
    client = _create_chroma_client()
    collection = client.get_or_create_collection(name="knowledge")
    query_embedding = _compute_embeddings([query])

    result = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    documents = result.get("documents", [])
    metadatas = result.get("metadatas", [])
    distances = result.get("distances", [])

    if not documents or not documents[0]:
        return []

    hits = []
    for idx, doc in enumerate(documents[0]):
        hits.append(
            {
                "content": doc,
                "source": metadatas[0][idx].get("source") if metadatas[0][idx] else "unknown",
                "page": metadatas[0][idx].get("page") if metadatas[0][idx] else -1,
                "score": float(distances[0][idx]) if distances and distances[0] else 0.0,
            }
        )
    return hits


def main() -> None:
    parser = __import__("argparse").ArgumentParser(
        description="将 rag-service/knowledge/ 中的 PDF/TXT 文档入库到 Chroma 向量数据库。"
    )
    parser.add_argument(
        "--drop",
        action="store_true",
        help="删除现有向量存储后重新入库。",
    )
    args = parser.parse_args()

    print("开始文档入库...")
    docs, chunks = ingest_all_pdfs(drop_existing=args.drop)
    print(f"完成：共处理 {docs} 个文档，生成 {chunks} 个向量片段。")


if __name__ == "__main__":
    main()
