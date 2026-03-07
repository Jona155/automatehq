"""
PDF page splitter — renders PDF pages to PNG image bytes.
Worker version: uses CardImage dataclass, no Vision detection (backend handles splitting).
Uses PyMuPDF (fitz) for rendering, OpenCV for image splitting.
"""
import cv2
import fitz  # PyMuPDF
import numpy as np
from dataclasses import dataclass
from typing import List

MAX_PDF_PAGES = 50
RENDER_DPI = 200
BLANK_THRESHOLD = 0.02
SPLIT_PADDING_PX = 15


@dataclass
class CardImage:
    image_bytes: bytes   # PNG bytes of one employee's card
    page_number: int     # 1-indexed source PDF page
    position: str        # 'TOP' | 'BOTTOM' | 'FULL'


def split_pdf_to_card_images(pdf_bytes: bytes) -> List[CardImage]:
    """
    Render each page of a PDF to a CardImage with position='FULL'.
    No layout detection — worker assumes backend already split double-stacked pages.

    Raises:
        ValueError: If PDF is corrupt, empty, password-protected, or too large
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ValueError(f"Cannot open PDF: {e}")

    if doc.is_encrypted:
        doc.close()
        raise ValueError("PDF is password-protected")

    page_count = doc.page_count
    if page_count == 0:
        doc.close()
        raise ValueError("PDF has no pages")
    if page_count > MAX_PDF_PAGES:
        doc.close()
        raise ValueError(f"PDF has {page_count} pages (max {MAX_PDF_PAGES})")

    cards: List[CardImage] = []
    mat = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)
    for page_num in range(page_count):
        page = doc.load_page(page_num)
        pix = page.get_pixmap(matrix=mat)
        cards.append(CardImage(
            image_bytes=pix.tobytes("png"),
            page_number=page_num + 1,
            position='FULL',
        ))

    doc.close()
    return cards


def is_pdf(file_bytes: bytes) -> bool:
    """Check if bytes start with PDF magic number."""
    return file_bytes[:5] == b'%PDF-'
