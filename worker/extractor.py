"""
Image extraction module — single-pass Vision extraction with OpenCV fallback.

Adapted from poc-worker/app.py for production use.
"""
import base64
import os
import logging
import re
import time
from typing import List, Optional, Dict, Any, Tuple, Iterable

import cv2
import numpy as np
from pydantic import BaseModel, Field
from openai import OpenAI, APITimeoutError, APIConnectionError
from passport_normalization import normalize_passport

logger = logging.getLogger('extraction_worker.extractor')

# Pipeline version for tracking
PIPELINE_VERSION = "1.3.0"

# OpenAI configuration
PRIMARY_VISION_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
FALLBACK_VISION_MODEL = os.environ.get("OPENAI_FALLBACK_MODEL", "gpt-4.1-mini")
FAST_VISION_MODEL = os.environ.get("OPENAI_FAST_VISION_MODEL", "gpt-4.1-mini")
OPENAI_VISION_MODEL_CHAIN = [
    model.strip()
    for model in os.environ.get("OPENAI_VISION_MODEL_CHAIN", "").split(",")
    if model and model.strip()
]
ENABLE_ROW_REREAD = os.environ.get("ENABLE_ROW_REREAD", "false").lower() == "true"
OPENAI_VISION_TIMEOUT_SECONDS = float(os.environ.get("OPENAI_VISION_TIMEOUT_SECONDS", "45"))
OPENAI_VISION_MAX_RETRIES = int(os.environ.get("OPENAI_VISION_MAX_RETRIES", "0"))
OPENAI_VISION_MAX_DIMENSION = max(1024, int(os.environ.get("OPENAI_VISION_MAX_DIMENSION", "2200")))
OPENAI_VISION_JPEG_QUALITY = min(95, max(50, int(os.environ.get("OPENAI_VISION_JPEG_QUALITY", "85"))))

# Initialize OpenAI client (uses OPENAI_API_KEY from environment)
_client: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    """Get or create OpenAI client."""
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def get_openai_client_with_timeout() -> OpenAI:
    """Get OpenAI client with per-request timeout override."""
    return get_openai_client().with_options(
        timeout=OPENAI_VISION_TIMEOUT_SECONDS,
        max_retries=OPENAI_VISION_MAX_RETRIES,
    )


def _dedupe_models(models: Iterable[Optional[str]]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for model in models:
        candidate = (model or "").strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        ordered.append(candidate)
    return ordered


def _model_attempt_chain(primary_model: str, fallback_model: Optional[str] = None) -> List[str]:
    return _dedupe_models(
        [
            primary_model,
            fallback_model,
            FAST_VISION_MODEL,
            *OPENAI_VISION_MODEL_CHAIN,
        ]
    )


# ===========================================
# Pydantic Models for Structured Output
# ===========================================

class WorkRow(BaseModel):
    """Single day entry from the work card."""
    day: int = Field(..., description="The day number printed on the card (1-31)")
    start_time: Optional[str] = Field(None, description="Start time in HH:MM format")
    end_time: Optional[str] = Field(None, description="End time in HH:MM format")
    total_hours: Optional[float] = Field(None, description="Total hours worked")
    confidence: Optional[float] = Field(None, description="Confidence score between 0 and 1 for the extracted row")
    notes: Optional[str] = Field(None, description="Optional note for uncertainty or legibility issues")
    row_state: Optional[str] = Field(
        None,
        description="One of WORKED, OFF_MARK, EMPTY, ILLEGIBLE",
    )
    mark_type: Optional[str] = Field(
        None,
        description="One of NONE, SINGLE_LINE, CROSS, HATCH",
    )
    row_confidence: Optional[float] = Field(
        None,
        description="Confidence score between 0 and 1 for row state/time semantics",
    )
    evidence: List[str] = Field(
        default_factory=list,
        description="Evidence tags such as time_pair, total_only, off_mark_detected, unclear",
    )


class WorkTable(BaseModel):
    """Collection of work entries from the card."""
    entries: List[WorkRow] = Field(default_factory=list, description="List of day entries")
    employee_name: Optional[str] = Field(None, description="Employee name if visible on card")
    passport_id: Optional[str] = Field(None, description="Passport/ID number if visible on card")


class HeaderInfo(BaseModel):
    """Header metadata from the work card (full image)."""
    employee_name: Optional[str] = Field(None, description="Employee name if visible on card")
    passport_id: Optional[str] = Field(None, description="Passport/ID number if visible on card")


class PassportIdCandidate(BaseModel):
    """Possible passport IDs detected on the image with location hinting."""
    raw: str = Field(..., description="Raw detected passport/ID candidate text")
    normalized: Optional[str] = Field(
        None,
        description="Alphanumeric normalized value derived from raw candidate text",
    )
    source_region: Optional[str] = Field(
        None,
        description="Where this value appears (e.g. header, footer, near name/signature)",
    )
    confidence: Optional[float] = Field(
        None,
        description="Confidence score between 0 and 1 for this candidate",
    )


class SinglePassExtraction(BaseModel):
    """Unified extraction result from one full-image vision call."""
    employee_name: Optional[str] = Field(None, description="Employee name if visible on card")
    passport_id_candidates: List[PassportIdCandidate] = Field(
        default_factory=list,
        description="All visible passport/ID candidates with approximate location hints",
    )
    selected_passport_id_normalized: Optional[str] = Field(
        None,
        description="Best normalized passport/ID value selected from candidates",
    )
    entries: List[WorkRow] = Field(
        default_factory=list,
        description="List of extracted day entries for visible day labels only",
    )


class TargetedRowReviewRequest(BaseModel):
    """Re-read response for uncertain day rows."""
    entries: List[WorkRow] = Field(
        default_factory=list,
        description="Reviewed rows for requested days only",
    )


# ===========================================
# OpenCV Image Processing
# ===========================================

def _parse_exif_orientation_from_app1(payload: bytes) -> Optional[int]:
    """Extract EXIF orientation (1-8) from a JPEG APP1 payload."""
    if not payload.startswith(b"Exif\x00\x00"):
        return None

    tiff = payload[6:]
    if len(tiff) < 8:
        return None

    byte_order = tiff[:2]
    if byte_order == b"II":
        endian = "little"
    elif byte_order == b"MM":
        endian = "big"
    else:
        return None

    if int.from_bytes(tiff[2:4], endian) != 42:
        return None

    ifd0_offset = int.from_bytes(tiff[4:8], endian)
    if ifd0_offset < 0 or ifd0_offset + 2 > len(tiff):
        return None

    entry_count = int.from_bytes(tiff[ifd0_offset:ifd0_offset + 2], endian)
    cursor = ifd0_offset + 2

    for _ in range(entry_count):
        if cursor + 12 > len(tiff):
            break

        tag = int.from_bytes(tiff[cursor:cursor + 2], endian)
        field_type = int.from_bytes(tiff[cursor + 2:cursor + 4], endian)
        value_count = int.from_bytes(tiff[cursor + 4:cursor + 8], endian)
        raw_value = tiff[cursor + 8:cursor + 12]
        cursor += 12

        if tag != 0x0112:
            continue

        orientation: Optional[int] = None
        if field_type == 3 and value_count == 1:
            # SHORT value packed directly into the 4-byte value field.
            orientation = int.from_bytes(raw_value[:2], endian)
        else:
            value_offset = int.from_bytes(raw_value, endian)
            if 0 <= value_offset <= len(tiff) - 2:
                orientation = int.from_bytes(tiff[value_offset:value_offset + 2], endian)

        if orientation is not None and 1 <= orientation <= 8:
            return orientation
        return None

    return None


def _extract_jpeg_exif_orientation(image_bytes: bytes) -> Optional[int]:
    """Read EXIF orientation from JPEG bytes when present."""
    if len(image_bytes) < 4 or image_bytes[:2] != b"\xFF\xD8":
        return None

    cursor = 2
    data_length = len(image_bytes)

    while cursor + 4 <= data_length:
        # Sync to JPEG marker boundary.
        while cursor < data_length and image_bytes[cursor] != 0xFF:
            cursor += 1
        if cursor + 1 >= data_length:
            break

        marker = image_bytes[cursor + 1]
        cursor += 2

        # Start of Scan / End of Image means no more APP metadata segments.
        if marker in (0xDA, 0xD9):
            break

        if cursor + 2 > data_length:
            break
        segment_length = int.from_bytes(image_bytes[cursor:cursor + 2], "big")
        if segment_length < 2 or cursor + segment_length > data_length:
            break

        if marker == 0xE1:
            payload = image_bytes[cursor + 2:cursor + segment_length]
            orientation = _parse_exif_orientation_from_app1(payload)
            if orientation is not None:
                return orientation

        cursor += segment_length

    return None


def _apply_exif_orientation(image: np.ndarray, orientation: Optional[int]) -> np.ndarray:
    if orientation is None or orientation == 1:
        return image
    if orientation == 2:
        return cv2.flip(image, 1)
    if orientation == 3:
        return cv2.rotate(image, cv2.ROTATE_180)
    if orientation == 4:
        return cv2.flip(image, 0)
    if orientation == 5:
        return cv2.transpose(image)
    if orientation == 6:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if orientation == 7:
        return cv2.flip(cv2.transpose(image), -1)
    if orientation == 8:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def _decode_image_bytes(image_bytes: bytes) -> np.ndarray:
    """Decode image bytes with EXIF orientation normalization."""
    file_bytes = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image")

    orientation = _extract_jpeg_exif_orientation(image_bytes)
    if orientation and orientation != 1:
        image = _apply_exif_orientation(image, orientation)
        logger.debug("Applied EXIF orientation correction: %s", orientation)
    return image

def crop_tables_from_image_bytes(image_bytes: bytes) -> List[np.ndarray]:
    """
    Detect and crop table sections from work card image.
    
    Work cards typically have two tables:
    - Days 1-15 on the right side
    - Days 16-31 on the left side
    
    Args:
        image_bytes: Raw image bytes (JPEG, PNG, etc.)
        
    Returns:
        List of cropped table images as numpy arrays (sorted right-to-left)
        
    Raises:
        ValueError: If image cannot be decoded
    """
    # Decode image from bytes (with EXIF orientation normalization)
    img = _decode_image_bytes(image_bytes)
    
    logger.debug(f"Image size: {img.shape[1]}x{img.shape[0]}")
    
    # 1. Convert to grayscale and blur
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # 2. Adaptive threshold to find table borders
    thresh = cv2.adaptiveThreshold(
        blur, 255, 
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 
        11, 2
    )
    
    # 3. Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # 4. Filter to find table-sized regions (at least 5% of image area)
    min_area = (img.shape[0] * img.shape[1]) * 0.05
    potential_tables = []
    
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area > min_area:
            x, y, w, h = cv2.boundingRect(cnt)
            potential_tables.append((x, y, w, h))
    
    # 5. Sort tables: Right to Left (x descending)
    # Days 1-15 are typically on the right, 16-31 on the left
    potential_tables.sort(key=lambda b: b[0], reverse=True)
    
    # 6. Extract crops with padding
    crops = []
    for (x, y, w, h) in potential_tables[:2]:  # Max 2 tables
        pad = 10
        y1 = max(0, y - pad)
        y2 = min(img.shape[0], y + h + pad)
        x1 = max(0, x - pad)
        x2 = min(img.shape[1], x + w + pad)
        
        crop = img[y1:y2, x1:x2]
        crops.append(crop)
    
    logger.info(f"Detected {len(crops)} table section(s)")
    
    # If no tables detected, return the full image as a single crop
    if not crops:
        logger.warning("No tables detected, using full image")
        crops = [img]
    
    return crops


def encode_image_to_base64(image_array: np.ndarray) -> str:
    """Convert OpenCV image array to base64 JPEG with bounded size for stable API latency."""
    prepared = image_array
    height, width = prepared.shape[:2]
    max_side = max(width, height)
    if max_side > OPENAI_VISION_MAX_DIMENSION:
        scale = OPENAI_VISION_MAX_DIMENSION / float(max_side)
        target_width = max(1, int(round(width * scale)))
        target_height = max(1, int(round(height * scale)))
        prepared = cv2.resize(prepared, (target_width, target_height), interpolation=cv2.INTER_AREA)
        logger.debug(
            "Downscaled image for vision from %sx%s to %sx%s",
            width,
            height,
            target_width,
            target_height,
        )

    success, buffer = cv2.imencode(
        '.jpg',
        prepared,
        [int(cv2.IMWRITE_JPEG_QUALITY), OPENAI_VISION_JPEG_QUALITY],
    )
    if not success:
        raise ValueError("Could not encode image for Vision request")
    return base64.b64encode(buffer).decode('utf-8')


def _parse_with_model_attempts(
    *,
    request_name: str,
    primary_model: str,
    fallback_model: Optional[str],
    messages: List[Dict[str, Any]],
    response_format: Any,
) -> Tuple[Optional[Any], Optional[str]]:
    client = get_openai_client_with_timeout()
    model_attempts = _model_attempt_chain(primary_model, fallback_model)
    last_error: Optional[Exception] = None

    for attempt_index, model_name in enumerate(model_attempts, start=1):
        started_at = time.perf_counter()
        try:
            response = client.beta.chat.completions.parse(
                model=model_name,
                messages=messages,
                response_format=response_format,
            )
            parsed = response.choices[0].message.parsed if response.choices else None
            if parsed is None:
                logger.warning(
                    "%s returned no parsed payload using model '%s' (attempt %s/%s)",
                    request_name,
                    model_name,
                    attempt_index,
                    len(model_attempts),
                )
                continue

            logger.info(
                "%s completed in %.2fs using model '%s' (attempt %s/%s)",
                request_name,
                time.perf_counter() - started_at,
                model_name,
                attempt_index,
                len(model_attempts),
            )
            return parsed, model_name
        except (APITimeoutError, APIConnectionError) as err:
            last_error = err
            logger.warning(
                "%s timed out/connection error after %.2fs using model '%s' (attempt %s/%s): %s",
                request_name,
                time.perf_counter() - started_at,
                model_name,
                attempt_index,
                len(model_attempts),
                err,
            )
        except Exception as err:
            last_error = err
            logger.warning(
                "%s failed after %.2fs using model '%s' (attempt %s/%s): %s",
                request_name,
                time.perf_counter() - started_at,
                model_name,
                attempt_index,
                len(model_attempts),
                err,
            )

    if last_error is not None:
        logger.error(
            "%s failed for all model attempts (%s): %s",
            request_name,
            ", ".join(model_attempts),
            last_error,
        )
    return None, None


# ===========================================
# GPT-4o Vision Extraction
# ===========================================

def extract_single_crop(crop_img: np.ndarray) -> Optional[WorkTable]:
    """
    Send a cropped table image to GPT-4o Vision for structured data extraction.
    
    Args:
        crop_img: Cropped table image as numpy array
    Returns:
        WorkTable with extracted entries, or None on error
    """
    base64_image = encode_image_to_base64(crop_img)

    parsed, _ = _parse_with_model_attempts(
        request_name="Crop extraction",
        primary_model=FALLBACK_VISION_MODEL,
        fallback_model=PRIMARY_VISION_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a data extraction AI specialized in reading handwritten work logs. "
                    "Extract work hours from the image. For each visible row label/day, extract start time, "
                    "end time, and total hours if visible. Return times in HH:MM format (24-hour). "
                    "Day values must come from visible row labels only and must never be inferred from table "
                    "position, crop position, or expected ranges. "
                    "Return null for empty or illegible entries. "
                    "Detect OFF_MARK rows: diagonal/horizontal pen lines or crosses indicating no work; "
                    "for OFF_MARK rows return null start/end/total unless clear time digits are visible. "
                    "Never treat line-only marks as hours. "
                    "Set row_state (WORKED/OFF_MARK/EMPTY/ILLEGIBLE), mark_type (NONE/SINGLE_LINE/CROSS/HATCH), "
                    "row_confidence (0-1), and evidence tags (time_pair, total_only, off_mark_detected, unclear). "
                    "Include an optional confidence value (0-1) and optional notes for uncertain rows. "
                    "Also extract the employee name and passport/ID number if visible anywhere on the card."
                )
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Extract handwritten work log rows from this image. "
                            "Only output rows where a day label is visible. "
                            "Do not infer the day from crop location or left/right placement. "
                            "If a row is marked by a strike/line with no clear digits, set OFF_MARK and null values. "
                            "Return null for empty rows."
                        )
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                    }
                ]
            }
        ],
        response_format=WorkTable,
    )
    return parsed


TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ROW_STATE_ALLOWED = {"WORKED", "OFF_MARK", "EMPTY", "ILLEGIBLE"}
MARK_TYPE_ALLOWED = {"NONE", "SINGLE_LINE", "CROSS", "HATCH"}


def _is_valid_time(value: Optional[str]) -> bool:
    if value is None:
        return False
    return bool(TIME_PATTERN.match(value.strip()))


def _entry_quality_score(entry: Dict[str, Any]) -> float:
    """Score entry quality for conflict resolution when duplicate day rows exist."""
    score = 0.0

    if _is_valid_time(entry.get('start_time')):
        score += 2.0
    if _is_valid_time(entry.get('end_time')):
        score += 2.0

    total_hours = entry.get('total_hours')
    if isinstance(total_hours, (int, float)) and 0 <= float(total_hours) <= 24:
        score += 2.0

    confidence = entry.get('confidence')
    if isinstance(confidence, (int, float)):
        score += max(0.0, min(float(confidence), 1.0)) * 3.0

    row_confidence = entry.get('row_confidence')
    if isinstance(row_confidence, (int, float)):
        score += max(0.0, min(float(row_confidence), 1.0)) * 2.0

    row_state = (entry.get('row_state') or '').upper()
    if row_state == "WORKED":
        score += 0.5
    elif row_state == "OFF_MARK":
        score += 0.25

    note = entry.get('notes')
    if isinstance(note, str) and note.strip():
        score += 0.25

    return score


def _time_to_minutes(value: Optional[str]) -> Optional[int]:
    if not _is_valid_time(value):
        return None
    parts = value.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def _hours_from_time_pair(start_time: Optional[str], end_time: Optional[str]) -> Optional[float]:
    start_minutes = _time_to_minutes(start_time)
    end_minutes = _time_to_minutes(end_time)
    if start_minutes is None or end_minutes is None:
        return None
    delta = end_minutes - start_minutes
    if delta < 0:
        delta += 24 * 60
    return round(delta / 60.0, 2)


def _normalize_row_state(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    candidate = str(value).strip().upper()
    if candidate in ROW_STATE_ALLOWED:
        return candidate
    return None


def _normalize_mark_type(value: Optional[str]) -> Optional[str]:
    if not value:
        return "NONE"
    candidate = str(value).strip().upper()
    if candidate in MARK_TYPE_ALLOWED:
        return candidate
    return "NONE"


def _normalize_evidence(value: Any) -> List[str]:
    if isinstance(value, list):
        cleaned = []
        seen = set()
        for item in value:
            if item is None:
                continue
            token = str(item).strip().lower()
            if not token or token in seen:
                continue
            cleaned.append(token)
            seen.add(token)
        return cleaned
    return []


def _coalesce_row_confidence(entry: Dict[str, Any]) -> Optional[float]:
    for key in ("row_confidence", "confidence"):
        value = entry.get(key)
        if isinstance(value, (int, float)):
            return max(0.0, min(float(value), 1.0))
    return None


def _normalize_entry_payload(entry: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(entry)
    normalized["row_state"] = _normalize_row_state(normalized.get("row_state"))
    normalized["mark_type"] = _normalize_mark_type(normalized.get("mark_type"))
    normalized["evidence"] = _normalize_evidence(normalized.get("evidence"))
    normalized["row_confidence"] = _coalesce_row_confidence(normalized)
    if normalized.get("confidence") is None:
        normalized["confidence"] = normalized.get("row_confidence")
    if normalized.get("total_hours") is not None:
        try:
            normalized["total_hours"] = round(float(normalized["total_hours"]), 2)
        except (TypeError, ValueError):
            normalized["total_hours"] = None
    return normalized


def _apply_semantic_gating(entries: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    gated_entries: List[Dict[str, Any]] = []
    review_required_days: List[int] = []
    off_mark_days: List[int] = []
    row_quality_by_day: Dict[str, Dict[str, Any]] = {}

    for raw_entry in entries:
        entry = _normalize_entry_payload(raw_entry)
        day = entry.get("day")
        if not isinstance(day, int) or day < 1 or day > 31:
            continue

        row_state = entry.get("row_state")
        mark_type = entry.get("mark_type") or "NONE"
        row_confidence = _coalesce_row_confidence(entry)
        evidence = _normalize_evidence(entry.get("evidence"))
        start_time = entry.get("start_time")
        end_time = entry.get("end_time")
        total_hours = entry.get("total_hours")

        has_valid_time_pair = _is_valid_time(start_time) and _is_valid_time(end_time)
        has_total_only = total_hours is not None and not has_valid_time_pair
        uncertain_reasons: List[str] = []

        if row_state is None:
            if has_valid_time_pair or total_hours is not None:
                row_state = "WORKED"
            elif mark_type != "NONE" or "off_mark_detected" in evidence:
                row_state = "OFF_MARK"
            elif "unclear" in evidence:
                row_state = "ILLEGIBLE"
            else:
                row_state = "EMPTY"
            entry["row_state"] = row_state

        if row_state == "OFF_MARK":
            off_mark_days.append(day)
            if not has_valid_time_pair:
                entry["start_time"] = None
                entry["end_time"] = None
                entry["total_hours"] = None
            else:
                uncertain_reasons.append("off_mark_with_time_values")

        if row_state in {"EMPTY", "ILLEGIBLE"} and not has_valid_time_pair:
            entry["start_time"] = None
            entry["end_time"] = None
            if row_state == "EMPTY":
                entry["total_hours"] = None

        if row_state == "WORKED":
            if has_valid_time_pair:
                derived = _hours_from_time_pair(entry.get("start_time"), entry.get("end_time"))
                if derived is None:
                    uncertain_reasons.append("invalid_time_pair")
                elif entry.get("total_hours") is None:
                    entry["total_hours"] = derived
                else:
                    if abs(float(entry["total_hours"]) - float(derived)) > 1.0:
                        uncertain_reasons.append("time_total_conflict")
            elif has_total_only:
                if not isinstance(row_confidence, (int, float)) or float(row_confidence) < 0.85:
                    uncertain_reasons.append("low_conf_total_only")
                    entry["total_hours"] = None
            else:
                uncertain_reasons.append("worked_without_values")

        if has_total_only and row_state != "WORKED":
            uncertain_reasons.append("total_only_non_worked_state")

        if (entry.get("start_time") and not _is_valid_time(entry.get("start_time"))) or (
            entry.get("end_time") and not _is_valid_time(entry.get("end_time"))
        ):
            uncertain_reasons.append("invalid_time_format")

        if isinstance(row_confidence, (int, float)) and float(row_confidence) < 0.80:
            uncertain_reasons.append("low_row_confidence")

        review_required = len(uncertain_reasons) > 0
        if review_required:
            review_required_days.append(day)

        row_quality_by_day[str(day)] = {
            "row_state": row_state,
            "mark_type": mark_type,
            "row_confidence": row_confidence,
            "has_valid_time_pair": has_valid_time_pair,
            "review_required": review_required,
            "reasons": uncertain_reasons,
            "evidence": evidence,
        }

        gated_entries.append(entry)

    return gated_entries, {
        "review_required_days": sorted(set(review_required_days)),
        "off_mark_days": sorted(set(off_mark_days)),
        "row_quality_by_day": row_quality_by_day,
    }


def _analyze_template_profile(image_bytes: bytes, crop_count: int) -> Dict[str, Any]:
    try:
        img = _decode_image_bytes(image_bytes)
    except ValueError:
        return {
            "orientation": "unknown",
            "table_sections_detected": crop_count,
            "table_layout_confidence": None,
            "row_density_estimate": None,
        }

    height, width = img.shape[:2]
    orientation = "landscape" if width >= height else "portrait"
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binary_inv = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        11,
        2,
    )
    non_zero = cv2.countNonZero(binary_inv)
    row_density = round(non_zero / float(width * height), 4) if width and height else None
    layout_confidence = 0.9 if crop_count >= 2 else (0.6 if crop_count == 1 else 0.3)
    return {
        "orientation": orientation,
        "image_width": width,
        "image_height": height,
        "table_sections_detected": crop_count,
        "table_layout_confidence": layout_confidence,
        "row_density_estimate": row_density,
    }


def _parse_time_for_sort(value: Optional[str]) -> int:
    parsed = _time_to_minutes(value)
    return parsed if parsed is not None else -1


def _compare_row_preference(existing: Dict[str, Any], candidate: Dict[str, Any]) -> bool:
    """Return True when candidate should replace existing entry for same day."""
    existing_norm = _normalize_entry_payload(existing)
    candidate_norm = _normalize_entry_payload(candidate)

    existing_state = existing_norm.get("row_state")
    candidate_state = candidate_norm.get("row_state")
    existing_conf = _coalesce_row_confidence(existing_norm) or 0.0
    candidate_conf = _coalesce_row_confidence(candidate_norm) or 0.0

    if existing_state == "WORKED" and candidate_state != "WORKED" and existing_conf >= 0.9:
        return False
    if existing_state in {"ILLEGIBLE", "EMPTY"} and candidate_state == "WORKED" and candidate_conf >= 0.8:
        return True
    if existing_state == "OFF_MARK" and candidate_state == "WORKED" and candidate_conf < existing_conf:
        return False

    candidate_score = _entry_quality_score(candidate_norm)
    existing_score = _entry_quality_score(existing_norm)
    if candidate_score == existing_score:
        if _parse_time_for_sort(candidate_norm.get("start_time")) > _parse_time_for_sort(existing_norm.get("start_time")):
            return True
        return False
    return candidate_score > existing_score


def _rerun_uncertain_days_full_image(
    image_bytes: bytes,
    uncertain_days: List[int],
) -> Optional[List[Dict[str, Any]]]:
    if not uncertain_days:
        return None

    try:
        img = _decode_image_bytes(image_bytes)
    except ValueError:
        return None

    base64_image = encode_image_to_base64(img)
    day_list = ", ".join(str(day) for day in sorted(set(uncertain_days)))

    parsed, _ = _parse_with_model_attempts(
        request_name="Targeted row reread",
        primary_model=PRIMARY_VISION_MODEL,
        fallback_model=FALLBACK_VISION_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are reviewing uncertain handwritten rows in a work-card table. "
                    "For each requested day, decide row_state WORKED or OFF_MARK or EMPTY or ILLEGIBLE. "
                    "If row_state is OFF_MARK and there are no clear time digits, set start_time/end_time/total_hours to null. "
                    "Never convert line-only marks into numeric hours. "
                    "Only return requested days."
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Re-evaluate only these days: {day_list}. "
                            "Return entries with day, start_time, end_time, total_hours, row_state, mark_type, "
                            "row_confidence, confidence, and evidence."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"},
                    },
                ],
            },
        ],
        response_format=TargetedRowReviewRequest,
    )
    if not parsed or not parsed.entries:
        return None

    requested = set(uncertain_days)
    reviewed_entries: List[Dict[str, Any]] = []
    for row in parsed.entries:
        row_dict = row.model_dump()
        day = row_dict.get("day")
        if day in requested:
            reviewed_entries.append(row_dict)
    return reviewed_entries or None


def extract_header_from_full_image(image_bytes: bytes) -> Optional[HeaderInfo]:
    """
    Extract employee name and passport/ID from the full image.

    Args:
        image_bytes: Raw image bytes

    Returns:
        HeaderInfo with employee_name/passport_id if found, else None
    """
    try:
        img = _decode_image_bytes(image_bytes)
    except ValueError as exc:
        raise ValueError("Could not decode image for header extraction") from exc

    base64_image = encode_image_to_base64(img)

    logger.debug("Sending full image to GPT-4o for header extraction")

    parsed, _ = _parse_with_model_attempts(
        request_name="Header extraction",
        primary_model=FALLBACK_VISION_MODEL,
        fallback_model=PRIMARY_VISION_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a data extraction AI. Extract only the employee name and "
                    "passport/ID number from the work card image header or any visible area. "
                    "If not visible or illegible, return null."
                )
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Extract the employee name and passport/ID number from this work card."
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                    }
                ]
            }
        ],
        response_format=HeaderInfo,
    )
    return parsed


def extract_data_from_crops(crop_images: List[np.ndarray]) -> Dict[str, Any]:
    """
    Extract data from multiple cropped table images.
    
    Args:
        crop_images: List of cropped table images
        
    Returns:
        Dict with 'entries' list and metadata
    """
    all_entries = []
    employee_name = None
    passport_id = None
    
    for i, crop_img in enumerate(crop_images):
        logger.info(f"Extracting data from crop {i+1}...")
        
        try:
            result = extract_single_crop(crop_img)
            
            if result and result.entries:
                # Convert Pydantic objects to dicts
                all_entries.extend([entry.model_dump() for entry in result.entries])
                logger.info(f"Extracted {len(result.entries)} rows from crop {i+1}")
                
                # Capture employee info if found
                if result.employee_name and not employee_name:
                    employee_name = result.employee_name
                if result.passport_id and not passport_id:
                    passport_id = normalize_passport(result.passport_id)
                    
        except Exception as e:
            logger.error(f"Failed to extract crop {i+1}: {e}")
            # Continue with other crops even if one fails
    
    # Sort entries by day and deduplicate
    if all_entries:
        # Keep best duplicate per day by confidence + field validity.
        best_by_day: Dict[int, Dict[str, Any]] = {}
        for entry in all_entries:
            day = entry.get('day')
            if day is None:
                continue

            existing = best_by_day.get(day)
            if not existing:
                best_by_day[day] = entry
                continue

            current_score = _entry_quality_score(entry)
            existing_score = _entry_quality_score(existing)
            if current_score > existing_score:
                best_by_day[day] = entry

        all_entries = [best_by_day[day] for day in sorted(best_by_day.keys())]
    
    logger.info(f"Total extracted: {len(all_entries)} unique day entries")
    
    return {
        'entries': all_entries,
        'extracted_employee_name': employee_name,
        'extracted_passport_id': normalize_passport(passport_id),
    }


def extract_full_image_single_pass(image_bytes: bytes) -> Tuple[Optional[SinglePassExtraction], Optional[str]]:
    """Send full image once to a stronger vision model for unified extraction."""

    try:
        img = _decode_image_bytes(image_bytes)
    except ValueError as exc:
        raise ValueError("Could not decode image for extraction") from exc

    base64_image = encode_image_to_base64(img)

    parsed, model_used = _parse_with_model_attempts(
        request_name="Single-pass extraction",
        primary_model=PRIMARY_VISION_MODEL,
        fallback_model=FALLBACK_VISION_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract structured data from scanned handwritten work cards. "
                    "Return day entries only where a day label is visibly present (1..31). "
                    "Never infer day numbers from table position. "
                    "Scan the entire page before answering, including header, footer, margins, "
                    "areas near signature/name fields, and handwritten notes. "
                    "Rows may include line/cross marks indicating off-days; do not treat line-only marks as worked hours. "
                    "Set row_state, mark_type, row_confidence and evidence for each row. "
                    "Also return employee name, all visible passport/ID candidates, and the best "
                    "selected normalized passport/ID value."
                )
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Extract from this full image in one response: employee_name, "
                            "passport_id_candidates [{raw, normalized, source_region, confidence}], "
                            "selected_passport_id_normalized, "
                            "and day entries. Include only days that are explicitly visible. "
                            "Use nulls for missing fields. Carefully inspect full page areas: "
                            "header, footer, margins, near signature/name fields, and handwritten notes; "
                            "do not only focus on expected form fields. "
                            "If a row has only strike/line marks and no clear time digits, classify as OFF_MARK "
                            "and keep start/end/total as null."
                        )
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                    }
                ]
            }
        ],
        response_format=SinglePassExtraction,
    )
    return parsed, model_used


def _build_result_from_single_pass(single_pass: SinglePassExtraction) -> Dict[str, Any]:
    best_by_day: Dict[int, Dict[str, Any]] = {}
    for entry in single_pass.entries:
        entry_dict = _normalize_entry_payload(entry.model_dump())
        day = entry_dict.get("day")
        if not isinstance(day, int) or day < 1 or day > 31:
            continue

        existing = best_by_day.get(day)
        if not existing or _compare_row_preference(existing, entry_dict):
            best_by_day[day] = entry_dict

    normalized_from_candidates = [
        normalize_passport(candidate.normalized or candidate.raw)
        for candidate in single_pass.passport_id_candidates
        if candidate.raw
    ]
    normalized_from_candidates = [v for v in normalized_from_candidates if v]

    selected_passport_id_normalized = normalize_passport(single_pass.selected_passport_id_normalized)
    if not selected_passport_id_normalized and normalized_from_candidates:
        selected_passport_id_normalized = normalized_from_candidates[0]

    candidate_list = []
    for candidate in single_pass.passport_id_candidates:
        candidate_normalized = normalize_passport(candidate.normalized or candidate.raw)
        candidate_list.append({
            "raw": candidate.raw,
            "normalized": candidate_normalized,
            "source_region": candidate.source_region,
            "confidence": candidate.confidence,
        })

    return {
        "entries": [best_by_day[day] for day in sorted(best_by_day.keys())],
        "extracted_employee_name": single_pass.employee_name,
        "extracted_passport_id": selected_passport_id_normalized,
        "passport_id_candidates": candidate_list,
        "normalized_passport_candidates": normalized_from_candidates,
        "selected_passport_id_normalized": selected_passport_id_normalized,
    }


def _single_pass_result_is_valid(result: Dict[str, Any]) -> bool:
    entries = result.get("entries", [])
    if not isinstance(entries, list):
        return False

    seen_days = set()
    for entry in entries:
        day = entry.get("day")
        if not isinstance(day, int) or day < 1 or day > 31 or day in seen_days:
            return False
        seen_days.add(day)
        row_state = entry.get("row_state")
        if row_state and _normalize_row_state(row_state) is None:
            return False
        mark_type = entry.get("mark_type")
        if mark_type and str(mark_type).strip().upper() not in MARK_TYPE_ALLOWED:
            return False

    return True


# ===========================================
# Main Entry Point
# ===========================================

def extract_from_image_bytes(image_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    Main extraction function — processes image bytes through full pipeline.
    
    Pipeline:
    1. Single-pass full-image extraction using stronger vision model
    2. Validate output
    3. Optional OpenCV + multi-call fallback if validation fails
    
    Args:
        image_bytes: Raw image bytes
        
    Returns:
        Dict containing:
        - entries: List of day entries [{day, start_time, end_time, total_hours}, ...]
        - extracted_employee_name: Employee name if found
        - extracted_passport_id: Passport/ID if found
        - raw_result: Original combined response
        - model_name: Model used for extraction
        - fallback_used: Whether OpenCV fallback path was required
        
        Returns None on complete failure
    """
    try:
        fallback_used = False
        semantic_quality = {
            "review_required_days": [],
            "off_mark_days": [],
            "row_quality_by_day": {},
        }

        logger.info("Starting single-pass full-image extraction...")
        single_pass, single_pass_model = extract_full_image_single_pass(image_bytes)
        if not single_pass:
            raise ValueError("Single-pass extraction returned no result")

        result = _build_result_from_single_pass(single_pass)
        result["entries"], semantic_quality = _apply_semantic_gating(result.get("entries", []))
        raw_result: Dict[str, Any] = {
            "strategy": "single_pass_full_image",
            "single_pass": single_pass.model_dump(),
            "single_pass_model": single_pass_model,
        }

        if not _single_pass_result_is_valid(result):
            fallback_used = True
            logger.warning("Single-pass extraction failed validation; using OpenCV fallback")

            crops = crop_tables_from_image_bytes(image_bytes)
            fallback_result = extract_data_from_crops(crops)

            header_result = None
            try:
                header_result = extract_header_from_full_image(image_bytes)
            except Exception as e:
                logger.error(f"Header extraction failed during fallback: {e}")

            if header_result:
                if header_result.employee_name:
                    fallback_result['extracted_employee_name'] = header_result.employee_name
                if header_result.passport_id:
                    fallback_result['extracted_passport_id'] = normalize_passport(header_result.passport_id)

            fallback_result['selected_passport_id_normalized'] = normalize_passport(
                fallback_result.get('extracted_passport_id')
            )
            fallback_result['passport_id_candidates'] = []
            fallback_result['normalized_passport_candidates'] = []
            fallback_result["entries"], semantic_quality = _apply_semantic_gating(fallback_result.get("entries", []))
            result = fallback_result
            raw_result["fallback"] = {
                "num_crops": len(crops),
                "entries": result.get("entries", []),
                "header_extraction": header_result.model_dump() if header_result else None,
            }
            raw_result["strategy"] = "opencv_fallback"

        if ENABLE_ROW_REREAD and semantic_quality["review_required_days"]:
            requested_days = list(semantic_quality["review_required_days"])
            try:
                reread_entries = _rerun_uncertain_days_full_image(
                    image_bytes=image_bytes,
                    uncertain_days=requested_days,
                )
                if reread_entries:
                    merged_by_day: Dict[int, Dict[str, Any]] = {
                        int(entry["day"]): _normalize_entry_payload(entry)
                        for entry in result.get("entries", [])
                        if isinstance(entry.get("day"), int)
                    }
                    for reread_entry in reread_entries:
                        day = reread_entry.get("day")
                        if not isinstance(day, int):
                            continue
                        candidate = _normalize_entry_payload(reread_entry)
                        existing = merged_by_day.get(day)
                        if not existing or _compare_row_preference(existing, candidate):
                            merged_by_day[day] = candidate
                    result["entries"] = [merged_by_day[day] for day in sorted(merged_by_day.keys())]
                    result["entries"], semantic_quality = _apply_semantic_gating(result.get("entries", []))
                    raw_result["targeted_reread"] = {
                        "enabled": True,
                        "requested_days": requested_days,
                        "applied_days": sorted(
                            day for day in (entry.get("day") for entry in reread_entries) if isinstance(day, int)
                        ),
                    }
            except Exception as reread_error:
                logger.warning("Targeted row reread failed: %s", reread_error)
                raw_result["targeted_reread"] = {
                    "enabled": True,
                    "error": str(reread_error),
                }

        crops_for_profile = crop_tables_from_image_bytes(image_bytes)
        template_profile = _analyze_template_profile(
            image_bytes=image_bytes,
            crop_count=len(crops_for_profile),
        )
        result["template_profile"] = template_profile
        result["row_quality"] = semantic_quality

        result['raw_result'] = raw_result
        result['raw_result']['selected_passport_id_normalized'] = result.get('selected_passport_id_normalized')
        result['raw_result']['passport_id_candidates'] = result.get('passport_id_candidates', [])
        result['raw_result']['normalized_passport_candidates'] = result.get('normalized_passport_candidates', [])
        result['raw_result']['row_quality'] = result.get('row_quality')
        result['raw_result']['template_profile'] = result.get('template_profile')
        result['model_name'] = single_pass_model or PRIMARY_VISION_MODEL
        result['fallback_used'] = fallback_used

        return result
        
    except ValueError as e:
        logger.error(f"Image processing error: {e}")
        return None
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise
