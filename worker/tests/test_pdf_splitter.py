"""Tests for worker/pdf_splitter.py"""
import io
import pytest
import cv2
import numpy as np

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from pdf_splitter import split_pdf_to_card_images, is_pdf, MAX_PDF_PAGES, CardImage


def _make_pdf(num_pages: int) -> bytes:
    """Create a minimal valid PDF with num_pages blank pages using PyMuPDF."""
    import fitz
    doc = fitz.open()
    for _ in range(num_pages):
        doc.new_page()
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _make_encrypted_pdf() -> bytes:
    """Create a password-protected PDF."""
    import fitz
    doc = fitz.open()
    doc.new_page()
    buf = io.BytesIO()
    doc.save(buf, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    doc.close()
    return buf.getvalue()


class TestIsPdf:
    def test_pdf_magic_number(self):
        assert is_pdf(b'%PDF-1.4 rest of content') is True

    def test_jpeg_not_pdf(self):
        assert is_pdf(b'\xff\xd8\xff\xe0JFIF') is False

    def test_empty_bytes_not_pdf(self):
        assert is_pdf(b'') is False

    def test_short_bytes_not_pdf(self):
        assert is_pdf(b'%PDF') is False  # only 4 bytes


class TestSplitPdfToCardImages:
    def test_single_page_returns_one_card(self):
        pdf = _make_pdf(1)
        cards = split_pdf_to_card_images(pdf)
        assert len(cards) == 1
        assert cards[0].position == 'FULL'
        assert cards[0].page_number == 1
        # PNG magic number
        assert cards[0].image_bytes[:8] == b'\x89PNG\r\n\x1a\n'

    def test_multi_page_returns_n_cards(self):
        pdf = _make_pdf(5)
        cards = split_pdf_to_card_images(pdf)
        assert len(cards) == 5
        for i, card in enumerate(cards):
            assert card.position == 'FULL'
            assert card.page_number == i + 1
            assert card.image_bytes[:8] == b'\x89PNG\r\n\x1a\n'

    def test_corrupt_bytes_raises_value_error(self):
        with pytest.raises(ValueError, match="Cannot open PDF"):
            split_pdf_to_card_images(b'this is not a pdf')

    def test_empty_bytes_raises_value_error(self):
        with pytest.raises(ValueError):
            split_pdf_to_card_images(b'')

    def test_encrypted_pdf_raises_value_error(self):
        pdf = _make_encrypted_pdf()
        with pytest.raises(ValueError, match="password-protected"):
            split_pdf_to_card_images(pdf)

    def test_too_many_pages_raises_value_error(self):
        pdf = _make_pdf(MAX_PDF_PAGES + 1)
        with pytest.raises(ValueError, match=f"max {MAX_PDF_PAGES}"):
            split_pdf_to_card_images(pdf)

    def test_exactly_max_pages_is_allowed(self):
        pdf = _make_pdf(MAX_PDF_PAGES)
        cards = split_pdf_to_card_images(pdf)
        assert len(cards) == MAX_PDF_PAGES

    def test_card_image_fields_present(self):
        pdf = _make_pdf(1)
        cards = split_pdf_to_card_images(pdf)
        card = cards[0]
        assert isinstance(card, CardImage)
        assert isinstance(card.image_bytes, bytes)
        assert isinstance(card.page_number, int)
        assert isinstance(card.position, str)

    def test_png_validity(self):
        pdf = _make_pdf(1)
        cards = split_pdf_to_card_images(pdf)
        nparr = np.frombuffer(cards[0].image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        assert img is not None
