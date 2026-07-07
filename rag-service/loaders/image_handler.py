"""
Image extraction from PyMuPDF pages.

Each extracted image is:
  1. Saved to {static_dir}/images/{doc_stem}_{page}_{idx}.png
  2. (Optional) Captioned by a vision LLM
  3. Returned as a DocumentBlock (block_type='image')

Tiny images (< MIN_IMAGE_BYTES) are skipped to avoid icons/decorators.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import List, Optional, TYPE_CHECKING

import fitz  # PyMuPDF

if TYPE_CHECKING:
    from loaders.pdf_loader import DocumentBlock

MIN_IMAGE_BYTES = 5_000   # skip images smaller than ~5 KB


def _save_image(
    fitz_doc: fitz.Document,
    xref: int,
    out_path: Path,
) -> bool:
    """Extract image by xref and write to out_path. Returns True on success."""
    try:
        base_image = fitz_doc.extract_image(xref)
        image_bytes = base_image.get("image", b"")
        if len(image_bytes) < MIN_IMAGE_BYTES:
            return False
        ext = base_image.get("ext", "png")
        # Always write as png (convert if needed)
        out_path = out_path.with_suffix(f".{ext}")
        out_path.write_bytes(image_bytes)
        return True
    except Exception:
        return False


def _generate_caption(image_path: Path) -> Optional[str]:
    """Call a vision LLM to caption the image.  Returns None on failure / disabled."""
    from config import settings
    if not settings.generate_image_captions:
        return None
    if not settings.llm_api_key or not settings.llm_base_url:
        return None

    try:
        import base64
        from openai import OpenAI

        data = image_path.read_bytes()
        b64  = base64.b64encode(data).decode()
        ext  = image_path.suffix.lstrip(".")
        mime = f"image/{ext}" if ext in ("png", "jpg", "jpeg", "gif", "webp") else "image/png"

        client = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)
        response = client.chat.completions.create(
            model=settings.image_caption_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "请用一句中文描述这张图片的主要内容，"
                                "格式：\"该图展示了...\"。不要超过50字。"
                            ),
                        },
                    ],
                }
            ],
            max_tokens=80,
            temperature=0.1,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"    Image caption LLM error: {e}", flush=True)
        return None


def extract_images_from_page(
    fitz_page: fitz.Page,
    fitz_doc: fitz.Document,
    page_num: int,
    doc_stem: str,
) -> List["DocumentBlock"]:
    """Extract images from a PyMuPDF page; return DocumentBlock list."""
    from config import settings
    from loaders.pdf_loader import DocumentBlock

    images_dir = settings.static_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    image_list = fitz_page.get_images(full=True)
    blocks: List[DocumentBlock] = []

    seen_xrefs: set = set()
    for img_idx, img_info in enumerate(image_list):
        xref = img_info[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)

        filename  = f"{doc_stem}_{page_num}_{img_idx}.png"
        abs_path  = images_dir / filename
        rel_url   = f"/static/images/{filename}"

        if not _save_image(fitz_doc, xref, abs_path):
            continue

        # Resolve actual extension (might have changed to .jpg etc.)
        saved = next(images_dir.glob(f"{doc_stem}_{page_num}_{img_idx}.*"), abs_path)
        rel_url = f"/static/images/{saved.name}"

        caption = _generate_caption(saved)

        # Only index if we have a caption; otherwise it's not searchable
        content = caption if caption else ""

        # Bounding box in PDF points
        bbox = None
        try:
            rects = fitz_page.get_image_rects(xref)
            if rects:
                r = rects[0]
                bbox = (r.x0, r.y0, r.x1, r.y1)
        except Exception:
            pass

        blocks.append(DocumentBlock(
            block_type="image",
            content=content,
            page=page_num,
            bbox=bbox,
            image_path=rel_url,
            image_abs_path=str(saved),
        ))

    return blocks
