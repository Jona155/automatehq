"""
PDF page splitter with auto-detection of double-stacked card layouts.
Uses PyMuPDF (fitz) for rendering, OpenCV for structural detection,
and GPT-4o-mini Vision as a fallback only when structure is ambiguous.
"""
import base64
import logging

import cv2
import fitz  # PyMuPDF
import numpy as np
from dataclasses import dataclass
from typing import List, Optional

from openai import OpenAI

logger = logging.getLogger(__name__)

MAX_PDF_PAGES = 50
RENDER_DPI = 200

# Structural detection parameters
GAP_SEARCH_START    = 0.35  # search for horizontal separator from 35% of page height
GAP_SEARCH_END      = 0.65  # … to 65%
GAP_WHITE_THRESHOLD = 0.85  # a row is "white" if >85% of its pixels are near-white
GAP_MIN_RUN_FRAC    = 0.03  # separator must span ≥3% of page height as a contiguous
                             # white band (real inter-card gaps are ~5.5%; empty table
                             # rows in digital PDFs are ~1.7% → clean separation)
LANDSCAPE_RATIO     = 1.1   # width/height > 1.1 → landscape → single card

# Splitting
SPLIT_PADDING_PX = 20     # pixels to trim on each side of the detected separator
BLANK_THRESHOLD  = 0.04   # bottom half is "blank" if <4% pixels are non-white

# Vision fallback
DETECTION_MAX_PX     = 800
DETECTION_JPEG_QUALITY = 70
DETECTION_TIMEOUT    = 30   # seconds


@dataclass
class CardImage:
    image_bytes: bytes   # PNG bytes of one employee's card
    page_number: int     # 1-indexed source PDF page
    position: str        # 'TOP' | 'BOTTOM' | 'FULL'


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def split_pdf_to_card_images(pdf_bytes: bytes) -> List[CardImage]:
    """
    Render PDF pages and auto-detect layout per page.

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
        page_png = pix.tobytes("png")
        page_number = page_num + 1

        layout = detect_page_layout(page_png)
        if layout == 'DOUBLE_STACKED':
            cards.extend(_split_cards(page_png, page_number))
        else:
            cards.append(CardImage(image_bytes=page_png, page_number=page_number, position='FULL'))

    doc.close()
    return cards


# ---------------------------------------------------------------------------
# Layout detection
# ---------------------------------------------------------------------------

def detect_page_layout(page_png: bytes) -> str:
    """
    Classify a page as 'SINGLE' or 'DOUBLE_STACKED'.

    Detection order (fastest / most reliable first):
      1. Landscape orientation → always SINGLE
      2. OpenCV white-gap structural detection → DOUBLE_STACKED / SINGLE
      3. GPT-4o-mini Vision fallback → DOUBLE_STACKED / SINGLE
    Falls back to SINGLE on any error.
    """
    try:
        nparr = np.frombuffer(page_png, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        h, w = img.shape[:2]

        # Step 1: landscape pages are never double-stacked
        if w > h * LANDSCAPE_RATIO:
            logger.debug("Page is landscape → SINGLE")
            return 'SINGLE'

        # Step 2: look for a horizontal white separator near the midpoint
        sep_y = _find_horizontal_separator(img)
        if sep_y is not None:
            logger.debug(f"Structural gap found at y={sep_y} ({sep_y/h:.1%}) → DOUBLE_STACKED")
            return 'DOUBLE_STACKED'

        logger.debug("No structural gap found, trying Vision fallback")

    except Exception as e:
        logger.warning(f"Structural layout detection failed: {e}")

    # Step 3: Vision API fallback
    return _vision_detect_layout(page_png)


def _find_horizontal_separator(img) -> Optional[int]:
    """
    Look for a wide contiguous white band in the 35–65% vertical range.
    Returns the y pixel coordinate of the band centre, or None if not found.

    Uses run-length on raw per-row white fractions rather than smoothed peaks
    so that narrow empty table rows (short runs) don't trigger false positives.
    """
    h = img.shape[0]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Fraction of near-white pixels per row (white = >240)
    white_fraction = (gray > 240).mean(axis=1)  # shape: (h,)

    start = int(h * GAP_SEARCH_START)
    end   = int(h * GAP_SEARCH_END)
    min_run_px = int(h * GAP_MIN_RUN_FRAC)

    best_center = None
    best_length = 0
    run_start   = None

    for y in range(start, end):
        if white_fraction[y] >= GAP_WHITE_THRESHOLD:
            if run_start is None:
                run_start = y
        else:
            if run_start is not None:
                length = y - run_start
                if length > best_length:
                    best_length = length
                    best_center = run_start + length // 2
                run_start = None

    # Close any run that reaches the end of the search band
    if run_start is not None:
        length = end - run_start
        if length > best_length:
            best_length = length
            best_center = run_start + length // 2

    if best_length >= min_run_px:
        return best_center
    return None


def _vision_detect_layout(page_png: bytes) -> str:
    """
    GPT-4o-mini Vision fallback. Sends a small JPEG thumbnail.
    Returns 'DOUBLE_STACKED' or 'SINGLE'. Falls back to 'SINGLE' on any error.
    """
    try:
        thumbnail_b64 = _make_detection_thumbnail(page_png)
        client = OpenAI(timeout=DETECTION_TIMEOUT)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": (
                        "This is a scanned work card (timesheet) image.\n"
                        "Count how many complete work card tables you see — "
                        "each table has its own header row with an employee name "
                        "and a grid of dates and hours.\n"
                        "Reply with ONLY the digit 1 or 2."
                    )},
                    {"type": "image_url", "image_url": {
                        "url": f"data:image/jpeg;base64,{thumbnail_b64}",
                        "detail": "low",
                    }}
                ]
            }],
            max_tokens=5,
        )
        answer = resp.choices[0].message.content.strip()
        result = 'DOUBLE_STACKED' if '2' in answer else 'SINGLE'
        logger.debug(f"Vision fallback answered '{answer}' → {result}")
        return result
    except Exception as e:
        logger.warning(f"Vision layout detection failed, defaulting to SINGLE: {e}")
        return 'SINGLE'


def _make_detection_thumbnail(page_png: bytes) -> str:
    """Resize to DETECTION_MAX_PX on longest side, encode as JPEG, return base64."""
    nparr = np.frombuffer(page_png, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    scale = min(DETECTION_MAX_PX / max(h, w), 1.0)
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, DETECTION_JPEG_QUALITY])
    return base64.b64encode(buf.tobytes()).decode()


# ---------------------------------------------------------------------------
# Splitting
# ---------------------------------------------------------------------------

def _split_cards(page_png: bytes, page_number: int) -> List[CardImage]:
    """
    Split a double-stacked page into TOP and BOTTOM cards.
    Finds the actual gap position for an accurate cut (not a fixed 50%).
    """
    nparr = np.frombuffer(page_png, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    h = img.shape[0]

    # Prefer detected gap; fall back to midpoint
    sep_y = _find_horizontal_separator(img) or (h // 2)

    top_end      = max(1, sep_y - SPLIT_PADDING_PX)
    bottom_start = min(h - 1, sep_y + SPLIT_PADDING_PX)

    top_img    = img[0:top_end, :]
    bottom_img = img[bottom_start:, :]

    cards = [CardImage(image_bytes=_encode_png(top_img), page_number=page_number, position='TOP')]
    if not _is_blank(bottom_img):
        cards.append(CardImage(image_bytes=_encode_png(bottom_img), page_number=page_number, position='BOTTOM'))

    return cards


def _is_blank(img) -> bool:
    """Return True if the image is mostly white/empty."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    non_white = np.sum(gray < 200) / gray.size
    return non_white < BLANK_THRESHOLD


def _encode_png(img) -> bytes:
    _, buf = cv2.imencode('.png', img)
    return buf.tobytes()


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def is_pdf(file_bytes: bytes) -> bool:
    """Check if bytes start with PDF magic number."""
    return file_bytes[:5] == b'%PDF-'
