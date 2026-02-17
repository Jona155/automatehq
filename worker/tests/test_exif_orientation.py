import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extractor import _apply_exif_orientation, _extract_jpeg_exif_orientation


def _build_exif_jpeg_bytes(orientation: int) -> bytes:
    # Minimal JPEG with one APP1 EXIF segment containing orientation tag (0x0112).
    tiff_header = b"MM" + (42).to_bytes(2, "big") + (8).to_bytes(4, "big")
    ifd_entry_count = (1).to_bytes(2, "big")
    orientation_entry = (
        (0x0112).to_bytes(2, "big")  # tag
        + (3).to_bytes(2, "big")  # type SHORT
        + (1).to_bytes(4, "big")  # count
        + orientation.to_bytes(2, "big")
        + b"\x00\x00"
    )
    next_ifd = (0).to_bytes(4, "big")
    exif_payload = b"Exif\x00\x00" + tiff_header + ifd_entry_count + orientation_entry + next_ifd
    app1 = b"\xFF\xE1" + (len(exif_payload) + 2).to_bytes(2, "big") + exif_payload
    return b"\xFF\xD8" + app1 + b"\xFF\xD9"


def test_extracts_jpeg_exif_orientation():
    jpeg = _build_exif_jpeg_bytes(8)
    assert _extract_jpeg_exif_orientation(jpeg) == 8


def test_apply_exif_orientation_rotates_90_clockwise_for_value_6():
    source = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.uint8)
    rotated = _apply_exif_orientation(source, 6)
    expected = np.array([[3, 0], [4, 1], [5, 2]], dtype=np.uint8)
    assert np.array_equal(rotated, expected)


def test_apply_exif_orientation_rotates_90_counterclockwise_for_value_8():
    source = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.uint8)
    rotated = _apply_exif_orientation(source, 8)
    expected = np.array([[2, 5], [1, 4], [0, 3]], dtype=np.uint8)
    assert np.array_equal(rotated, expected)
