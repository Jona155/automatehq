"""Utilities for passport normalization and validation."""
import os
import re
from typing import Iterable, List, Optional

SEPARATOR_PATTERN = re.compile(r"[\s.\-/,]+")
PASSPORT_FORMAT_PATTERN = re.compile(r"^[A-Z]?\d+$")
DEFAULT_MIN_LENGTH = 5
DEFAULT_MAX_LENGTH = 12


def get_passport_length_bounds(
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
) -> tuple[int, int]:
    """Return normalized passport length bounds from args or env."""
    resolved_min = min_length if min_length is not None else int(
        os.environ.get("PASSPORT_NORMALIZED_MIN_LENGTH", str(DEFAULT_MIN_LENGTH))
    )
    resolved_max = max_length if max_length is not None else int(
        os.environ.get("PASSPORT_NORMALIZED_MAX_LENGTH", str(DEFAULT_MAX_LENGTH))
    )
    if resolved_min <= 0:
        resolved_min = DEFAULT_MIN_LENGTH
    if resolved_max < resolved_min:
        resolved_max = max(resolved_min, DEFAULT_MAX_LENGTH)
    return resolved_min, resolved_max


def normalize_passport(
    value: Optional[str],
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
) -> Optional[str]:
    """Normalize passport values and reject unsupported formats/lengths."""
    if not value:
        return None

    cleaned = SEPARATOR_PATTERN.sub("", value.upper()).strip()
    if not cleaned:
        return None

    # Keep only optional leading letter prefix + digits.
    if not PASSPORT_FORMAT_PATTERN.match(cleaned):
        return None

    min_len, max_len = get_passport_length_bounds(min_length, max_length)
    if len(cleaned) < min_len or len(cleaned) > max_len:
        return None

    return cleaned


def normalize_passport_candidates(values: Iterable[str]) -> List[str]:
    """Normalize and de-duplicate candidate passport values."""
    normalized: List[str] = []
    seen = set()
    for value in values:
        candidate = normalize_passport(value)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized
