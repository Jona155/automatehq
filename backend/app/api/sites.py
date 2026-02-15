import logging
import os

from flask import Blueprint, request
from twilio.rest import Client

from ..repositories.employee_repository import EmployeeRepository
from ..repositories.site_repository import SiteRepository
from ..repositories.upload_access_request_repository import UploadAccessRequestRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from ..repositories.work_card_repository import WorkCardRepository
from ..services.sites import AccessLinkService, ExportService, HoursMatrixService

logger = logging.getLogger(__name__)

sites_bp = Blueprint('sites', __name__, url_prefix='/api/sites')
repo = SiteRepository()
employee_repo = EmployeeRepository()
work_card_repo = WorkCardRepository()
extraction_repo = WorkCardExtractionRepository()
access_repo = UploadAccessRequestRepository()

hours_matrix_service = HoursMatrixService(employee_repo, work_card_repo, extraction_repo)
export_service = ExportService(hours_matrix_service)
access_link_service = AccessLinkService(
    access_repo=access_repo,
    employee_repo=employee_repo,
    site_repo=repo,
    twilio_client_factory=lambda: Client(
        os.environ.get('TWILIO_ACCOUNT_SID'),
        os.environ.get('TWILIO_AUTH_TOKEN'),
    ),
    host_url_builder=lambda: request.host_url,
)

from . import sites_crud, sites_matrix, sites_exports, sites_access_links  # noqa: E402,F401
