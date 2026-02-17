"""
Image extraction module — OpenCV table cropping + GPT-4o Vision structured extraction.

Adapted from poc-worker/app.py for production use.
"""
import base64
import os
import logging
import re
from typing import List, Optional, Dict, Any

import cv2
import numpy as np
from pydantic import BaseModel, Field
from openai import OpenAI

logger = logging.getLogger('extraction_worker.extractor')

# Pipeline version for tracking
PIPELINE_VERSION = "1.2.0"

# OpenAI configuration
GPT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")

# Initialize OpenAI client (uses OPENAI_API_KEY from environment)
_client: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    """Get or create OpenAI client."""
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


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


class WorkTable(BaseModel):
    """Collection of work entries from the card."""
    entries: List[WorkRow] = Field(default_factory=list, description="List of day entries")
    employee_name: Optional[str] = Field(None, description="Employee name if visible on card")
    passport_id: Optional[str] = Field(None, description="Passport/ID number if visible on card")


class HeaderInfo(BaseModel):
    """Header metadata from the work card (full image)."""
    employee_name: Optional[str] = Field(None, description="Employee name if visible on card")
    passport_id: Optional[str] = Field(None, description="Passport/ID number if visible on card")


# ===========================================
# OpenCV Image Processing
# ===========================================

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
    # Decode image from bytes
    file_bytes = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    
    if img is None:
        raise ValueError("Could not decode image")
    
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
    """Convert OpenCV image array to base64 string."""
    _, buffer = cv2.imencode('.jpg', image_array)
    return base64.b64encode(buffer).decode('utf-8')


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
    client = get_openai_client()
    base64_image = encode_image_to_base64(crop_img)
    
    logger.debug("Sending crop to GPT-4o")
    
    response = client.beta.chat.completions.parse(
        model=GPT_MODEL,
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
        response_format=WorkTable
    )
    
    return response.choices[0].message.parsed


TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


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

    note = entry.get('notes')
    if isinstance(note, str) and note.strip():
        score += 0.25

    return score


def extract_header_from_full_image(image_bytes: bytes) -> Optional[HeaderInfo]:
    """
    Extract employee name and passport/ID from the full image.

    Args:
        image_bytes: Raw image bytes

    Returns:
        HeaderInfo with employee_name/passport_id if found, else None
    """
    client = get_openai_client()

    file_bytes = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image for header extraction")

    base64_image = encode_image_to_base64(img)

    logger.debug("Sending full image to GPT-4o for header extraction")

    response = client.beta.chat.completions.parse(
        model=GPT_MODEL,
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
        response_format=HeaderInfo
    )

    return response.choices[0].message.parsed


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
                    passport_id = result.passport_id
                    
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
        'extracted_passport_id': passport_id,
    }


# ===========================================
# Main Entry Point
# ===========================================

def extract_from_image_bytes(image_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    Main extraction function — processes image bytes through full pipeline.
    
    Pipeline:
    1. OpenCV: Detect and crop table regions
    2. GPT-4o Vision: Extract structured data from each crop
    3. Combine and normalize results
    
    Args:
        image_bytes: Raw image bytes
        
    Returns:
        Dict containing:
        - entries: List of day entries [{day, start_time, end_time, total_hours}, ...]
        - extracted_employee_name: Employee name if found
        - extracted_passport_id: Passport/ID if found
        - raw_result: Original combined response
        - model_name: Model used for extraction
        
        Returns None on complete failure
    """
    try:
        # Phase 1: OpenCV table cropping
        logger.info("Starting image processing...")
        crops = crop_tables_from_image_bytes(image_bytes)

        # Phase 2: GPT-4o Vision extraction (tables)
        logger.info("Starting data extraction...")
        result = extract_data_from_crops(crops)

        # Phase 3: GPT-4o Vision extraction (full image header)
        header_result = None
        try:
            header_result = extract_header_from_full_image(image_bytes)
        except Exception as e:
            logger.error(f"Header extraction failed: {e}")

        if header_result:
            if header_result.employee_name:
                result['extracted_employee_name'] = header_result.employee_name
            if header_result.passport_id:
                result['extracted_passport_id'] = header_result.passport_id
        
        # Add metadata
        result['raw_result'] = {
            'num_crops': len(crops),
            'entries': result.get('entries', []),
            'header_extraction': header_result.model_dump() if header_result else None,
        }
        result['model_name'] = GPT_MODEL
        
        return result
        
    except ValueError as e:
        logger.error(f"Image processing error: {e}")
        return None
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise
