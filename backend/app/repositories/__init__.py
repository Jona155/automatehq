"""
Repository layer for data access.

This module provides a clean abstraction over database operations,
following the repository pattern. All database access should go through
these repositories rather than directly using SQLAlchemy models.

Usage:
    from app.repositories import UserRepository, SiteRepository, BusinessRepository
    
    user_repo = UserRepository()
    user = user_repo.get_by_email("admin@example.com")
    
    site_repo = SiteRepository()
    sites = site_repo.get_active_sites()
    
    business_repo = BusinessRepository()
    business = business_repo.get_by_code("automatehq")
"""

from .base import BaseRepository
from .business_repository import BusinessRepository
from .user_repository import UserRepository
from .site_repository import SiteRepository
from .employee_repository import EmployeeRepository
from .work_card_repository import WorkCardRepository
from .work_card_file_repository import WorkCardFileRepository
from .work_card_extraction_repository import WorkCardExtractionRepository
from .work_card_day_entry_repository import WorkCardDayEntryRepository
from .export_run_repository import ExportRunRepository
from .audit_event_repository import AuditEventRepository
from .upload_access_request_repository import UploadAccessRequestRepository
from .telegram_repository import TelegramConfigRepository, TelegramIngestedFileRepository, TelegramPollingStateRepository

__all__ = [
    'BaseRepository',
    'BusinessRepository',
    'UserRepository',
    'SiteRepository',
    'EmployeeRepository',
    'WorkCardRepository',
    'WorkCardFileRepository',
    'WorkCardExtractionRepository',
    'WorkCardDayEntryRepository',
    'ExportRunRepository',
    'AuditEventRepository',
    'UploadAccessRequestRepository',
    'TelegramConfigRepository',
    'TelegramIngestedFileRepository',
    'TelegramPollingStateRepository',
]
