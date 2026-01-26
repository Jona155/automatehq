"""
Repository layer for data access.

This module provides a clean abstraction over database operations,
following the repository pattern. All database access should go through
these repositories rather than directly using SQLAlchemy models.

Usage:
    from app.repositories import UserRepository, SiteRepository
    
    user_repo = UserRepository()
    user = user_repo.get_by_email("admin@example.com")
    
    site_repo = SiteRepository()
    sites = site_repo.get_active_sites()
"""

from .base import BaseRepository
from .user_repository import UserRepository
from .site_repository import SiteRepository
from .employee_repository import EmployeeRepository
from .work_card_repository import WorkCardRepository
from .work_card_file_repository import WorkCardFileRepository
from .work_card_extraction_repository import WorkCardExtractionRepository
from .work_card_day_entry_repository import WorkCardDayEntryRepository
from .export_run_repository import ExportRunRepository
from .audit_event_repository import AuditEventRepository

__all__ = [
    'BaseRepository',
    'UserRepository',
    'SiteRepository',
    'EmployeeRepository',
    'WorkCardRepository',
    'WorkCardFileRepository',
    'WorkCardExtractionRepository',
    'WorkCardDayEntryRepository',
    'ExportRunRepository',
    'AuditEventRepository',
]
