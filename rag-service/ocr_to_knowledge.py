import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Sequence

import fitz
import numpy as np

from config import settings


EMPTY_PAGE_CHAR_THRESHOLD = 20
PAGE_NUMBER_LINE_PATTERN = re.compile(r"^[\-—–_\s]*\d{1,4}[\-—–_\s]*$")
LIST_ITEM_PATTERN = re.compile(
    r"^(?:[（(]?\d+[)）.、]|[A-Za-z][.)]|[一二三四五六七八九十]+[、.])"
)
OCR_PROJECT_BASE_DIR = Path(__file__).resolve().parent


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="将扫描版 PDF OCR 为逐页 TXT，并输出到 knowledge/ 下供 ingest.py 继续入库。"
    )
    parser.add_argument("--pdf", required=True, help="扫描版 PDF 文件路径。")
    parser.add_argument(
        "--start-page",
        type=int,
        default=settings.ocr_default_start_page,
        help=f"起始页码，默认 {settings.ocr_default_start_page}。",
    )
    parser.add_argument(
        "--end-page",
        type=int,
        default=settings.ocr_default_end_page,
        help=f"结束页码，默认 {settings.ocr_default_end_page}。",
    )
    parser.add_argument(
        "--all-pages",
        action="store_true",
        help="忽略默认结束页，直接处理从 start-page 到全文末页。",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="OCR 输出目录，默认使用 config.py 中的 OCR_OUTPUT_DIR。",
    )
    parser.add_argument(
        "--lang",
        default=settings.ocr_language,
        help=f"PaddleOCR 语言参数，默认 {settings.ocr_language}。",
    )
    parser.add_argument(
        "--zoom",
        type=float,
        default=settings.ocr_zoom,
        help=f"PDF 渲染缩放倍率，默认 {settings.ocr_zoom}。",
    )
    return parser


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def _resolve_cli_path(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else (Path.cwd() / path)


def _create_ocr_engine(lang: str):
    try:
        os.environ.setdefault("PADDLE_OCR_BASE_DIR", str(OCR_PROJECT_BASE_DIR / ".paddleocr"))
        os.environ.setdefault("PADDLE_HOME", str(OCR_PROJECT_BASE_DIR / ".paddle"))
        os.environ.setdefault("FLAGS_use_mkldnn", "0")

        from paddleocr import PaddleOCR
    except Exception as exc:
        raise RuntimeError(
            "未检测到可用的 PaddleOCR 运行环境。请先在 rag-service 的 .venv 中安装与当前平台匹配的 paddlepaddle，再执行 pip install -r requirements.txt。"
        ) from exc

    try:
        return PaddleOCR(
            use_angle_cls=True,
            lang=lang,
            show_log=False,
            use_gpu=False,
            enable_mkldnn=False,
            cpu_threads=4,
        )
    except Exception as exc:
        raise RuntimeError(
            f"PaddleOCR 初始化失败: {exc}。请确认 paddlepaddle 与 paddleocr 版本匹配。"
        ) from exc


def _normalize_inline_spaces(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    return text.strip()


def _is_noise_line(line: str) -> bool:
    compact = re.sub(r"\s+", "", line)
    if not compact:
        return True
    if PAGE_NUMBER_LINE_PATTERN.fullmatch(compact):
        return True
    if len(compact) <= 2 and not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", compact):
        return True
    return False


def _should_start_new_paragraph(previous_line: str, current_line: str) -> bool:
    if not previous_line:
        return True
    if LIST_ITEM_PATTERN.match(current_line):
        return True
    if previous_line.endswith(("。", "！", "？", "!", "?", ";", "；", ":", "：")):
        return True
    if previous_line.endswith(("-", "—", "–", "/")):
        return False
    if len(previous_line) <= 10 and not previous_line.endswith(("，", ",", "、")):
        return True
    return False


def _join_line(previous_line: str, current_line: str) -> str:
    if not previous_line:
        return current_line
    if re.search(r"[A-Za-z0-9]$", previous_line) and re.match(r"^[A-Za-z0-9]", current_line):
        return f"{previous_line} {current_line}"
    return f"{previous_line}{current_line}"


def _clean_ocr_text(raw_text: str) -> str:
    normalized = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = normalized.split("\n")
    prepared_lines: List[str] = []

    for raw_line in raw_lines:
        line = _normalize_inline_spaces(raw_line)
        if _is_noise_line(line):
            continue
        prepared_lines.append(line)

    if not prepared_lines:
        return ""

    paragraphs: List[str] = []
    for line in prepared_lines:
        if not paragraphs or _should_start_new_paragraph(paragraphs[-1], line):
            paragraphs.append(line)
        else:
            paragraphs[-1] = _join_line(paragraphs[-1], line)

    cleaned = "\n\n".join(paragraph.strip() for paragraph in paragraphs if paragraph.strip())
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _render_page_to_image(page: fitz.Page, zoom: float) -> np.ndarray:
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 1:
        image = np.repeat(image, 3, axis=2)
    elif pix.n > 3:
        image = image[:, :, :3]
    return image


def _extract_text_lines(ocr_result: Any) -> List[str]:
    if not ocr_result:
        return []

    candidates: List[tuple[float, float, str]] = []
    lines: Sequence[Any] = ocr_result
    if isinstance(ocr_result, list) and ocr_result and isinstance(ocr_result[0], list):
        lines = ocr_result[0]

    for item in lines:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        points, text_info = item[0], item[1]
        if not isinstance(text_info, (list, tuple)) or not text_info:
            continue
        text = str(text_info[0]).strip()
        if not text:
            continue

        x = 0.0
        y = 0.0
        if isinstance(points, (list, tuple)) and points:
            xy_points = [point for point in points if isinstance(point, (list, tuple)) and len(point) >= 2]
            if xy_points:
                x = float(min(point[0] for point in xy_points))
                y = float(min(point[1] for point in xy_points))

        candidates.append((y, x, text))

    candidates.sort(key=lambda item: (round(item[0] / 5), item[1]))
    return [text for _, _, text in candidates]


def _run_ocr(ocr_engine: Any, image_array: np.ndarray) -> str:
    result = ocr_engine.ocr(image_array, cls=True)
    return "\n".join(_extract_text_lines(result)).strip()


def _write_page_text(output_dir: Path, page_number: int, text: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    page_path = output_dir / f"page_{page_number:04d}.txt"
    content = f"[PAGE {page_number}]\n"
    if text:
        content += f"\n{text}\n"
    page_path.write_text(content, encoding="utf-8")
    return page_path


def _build_report_path(output_dir: Path, start_page: int, end_page: int) -> Path:
    return output_dir / f"ocr_report_p{start_page:04d}_p{end_page:04d}.json"


def _validate_page_range(total_pages: int, start_page: int, end_page: int) -> tuple[int, int]:
    if start_page < 1:
        raise ValueError("start-page 必须大于等于 1。")
    if start_page > total_pages:
        raise ValueError(f"start-page 超出 PDF 总页数，当前总页数为 {total_pages}。")

    safe_end_page = min(end_page, total_pages)
    if safe_end_page < start_page:
        raise ValueError("end-page 不能小于 start-page。")
    return start_page, safe_end_page


def main() -> int:
    _configure_logging()
    parser = _build_parser()
    args = parser.parse_args()

    pdf_path = _resolve_cli_path(args.pdf)
    if not pdf_path.exists() or not pdf_path.is_file():
        logging.error("PDF 文件不存在: %s", pdf_path)
        return 1

    output_dir = settings.ocr_output_dir
    if args.output_dir:
        output_dir = _resolve_cli_path(args.output_dir)

    try:
        ocr_engine = _create_ocr_engine(args.lang)
    except Exception as exc:
        logging.error(str(exc))
        return 1

    try:
        document = fitz.open(pdf_path)
    except Exception as exc:
        logging.error("无法打开 PDF: %s", exc)
        return 1

    total_pages = document.page_count
    requested_end_page = total_pages if args.all_pages else args.end_page

    try:
        start_page, end_page = _validate_page_range(total_pages, args.start_page, requested_end_page)
    except ValueError as exc:
        logging.error(str(exc))
        return 1

    logging.info("开始 OCR: pdf=%s", pdf_path)
    logging.info("输出目录: %s", output_dir)
    logging.info("页码范围: %s-%s / %s", start_page, end_page, total_pages)
    logging.info("渲染缩放倍率: %s, 语言: %s", args.zoom, args.lang)

    page_reports: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    suspected_empty_pages: List[int] = []
    success_pages = 0
    failed_pages = 0

    for page_number in range(start_page, end_page + 1):
        try:
            page = document[page_number - 1]
            image_array = _render_page_to_image(page, args.zoom)
            raw_text = _run_ocr(ocr_engine, image_array)
            cleaned_text = _clean_ocr_text(raw_text)
            output_path = _write_page_text(output_dir, page_number, cleaned_text)
            char_count = len(cleaned_text)
            suspected_empty = char_count < EMPTY_PAGE_CHAR_THRESHOLD

            if suspected_empty:
                suspected_empty_pages.append(page_number)

            page_reports.append(
                {
                    "page": page_number,
                    "output_file": str(output_path),
                    "characters": char_count,
                    "suspected_empty": suspected_empty,
                }
            )
            success_pages += 1
            logging.info(
                "页 %s 完成，字符数=%s%s",
                page_number,
                char_count,
                "，疑似空页" if suspected_empty else "",
            )
        except Exception as exc:
            failed_pages += 1
            errors.append(
                {
                    "page": page_number,
                    "error": str(exc),
                }
            )
            logging.exception("页 %s OCR 失败", page_number)

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_pdf": str(pdf_path),
        "output_dir": str(output_dir),
        "total_pages_in_pdf": total_pages,
        "processed_page_range": {
            "start_page": start_page,
            "end_page": end_page,
        },
        "successful_pages": success_pages,
        "failed_pages": failed_pages,
        "suspected_empty_pages": suspected_empty_pages,
        "page_reports": page_reports,
        "errors": errors,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = _build_report_path(output_dir, start_page, end_page)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logging.info("OCR 完成，报告已写入: %s", report_path)
    logging.info(
        "汇总: 成功页=%s, 失败页=%s, 疑似空页=%s",
        success_pages,
        failed_pages,
        len(suspected_empty_pages),
    )

    return 0 if success_pages > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
