"""
Helper for expanding uploaded files: PDFs are split into per-card PNG images
(with auto-detection of double-stacked layouts), images are passed through unchanged.
This is a pure pre-processing step that feeds into the existing upload pipeline
without touching extraction logic.
"""
from typing import List, Dict, Any

from .pdf_splitter import split_pdf_to_card_images, is_pdf


def expand_uploaded_file(
    file_data: bytes,
    content_type: str,
    filename: str,
) -> List[Dict[str, Any]]:
    """
    If the file is a PDF, split into per-card PNG images (auto-detecting
    double-stacked layouts via Vision API).
    If the file is an image, return it as-is in a single-element list.

    Returns:
        List of dicts with keys:
          image_bytes           — bytes to store in work_card_files
          content_type          — MIME type for the stored file (image/png for PDF pages)
          original_content_type — the original upload MIME type
          filename              — original filename (same for all pages)
          page_number           — 1-based page number, or None for plain images
          page_position         — 'TOP', 'BOTTOM', 'FULL', or None for plain images

    Raises:
        ValueError: if the PDF is corrupt, encrypted, empty, or too large
    """
    if content_type == 'application/pdf' or is_pdf(file_data):
        cards = split_pdf_to_card_images(file_data)
        return [
            {
                'image_bytes': card.image_bytes,
                'content_type': 'image/png',
                'original_content_type': 'application/pdf',
                'filename': filename,
                'page_number': card.page_number,
                'page_position': card.position,
            }
            for card in cards
        ]
    else:
        return [
            {
                'image_bytes': file_data,
                'content_type': content_type,
                'original_content_type': content_type,
                'filename': filename,
                'page_number': None,
                'page_position': None,
            }
        ]
