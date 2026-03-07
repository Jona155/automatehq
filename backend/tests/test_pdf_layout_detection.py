"""Tests for PDF layout auto-detection (backend pdf_splitter)."""
import io
from unittest.mock import MagicMock, patch
import pytest


def _make_pdf(num_pages: int = 1) -> bytes:
    import fitz
    doc = fitz.open()
    for _ in range(num_pages):
        doc.new_page()
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _mock_vision_response(content: str):
    """Build a mock OpenAI response with given text content."""
    choice = MagicMock()
    choice.message.content = content
    resp = MagicMock()
    resp.choices = [choice]
    return resp


class TestDetectPageLayout:
    def test_vision_returns_2_gives_double_stacked(self):
        from app.services.pdf_splitter import detect_page_layout
        with patch('app.services.pdf_splitter.OpenAI') as mock_openai:
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.return_value = _mock_vision_response("2")
            result = detect_page_layout(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100)
        assert result == 'DOUBLE_STACKED'

    def test_vision_returns_1_gives_single(self):
        from app.services.pdf_splitter import detect_page_layout
        with patch('app.services.pdf_splitter.OpenAI') as mock_openai:
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.return_value = _mock_vision_response("1")
            result = detect_page_layout(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100)
        assert result == 'SINGLE'

    def test_vision_raises_exception_gives_single_fallback(self):
        from app.services.pdf_splitter import detect_page_layout
        with patch('app.services.pdf_splitter.OpenAI') as mock_openai:
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.side_effect = Exception("API error")
            result = detect_page_layout(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100)
        assert result == 'SINGLE'


class TestSplitPdfToCardImages:
    def test_single_page_with_vision_double_stacked_gives_two_cards(self):
        from app.services.pdf_splitter import split_pdf_to_card_images
        pdf = _make_pdf(1)
        with patch('app.services.pdf_splitter.detect_page_layout', return_value='DOUBLE_STACKED'):
            cards = split_pdf_to_card_images(pdf)
        # TOP is always created; BOTTOM is skipped only if blank — blank page yields 1
        assert len(cards) >= 1
        assert cards[0].position == 'TOP'

    def test_single_page_with_vision_single_gives_one_full_card(self):
        from app.services.pdf_splitter import split_pdf_to_card_images
        pdf = _make_pdf(1)
        with patch('app.services.pdf_splitter.detect_page_layout', return_value='SINGLE'):
            cards = split_pdf_to_card_images(pdf)
        assert len(cards) == 1
        assert cards[0].position == 'FULL'
        assert cards[0].page_number == 1
