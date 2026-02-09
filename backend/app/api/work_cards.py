from flask import Blueprint, request, g, send_file
from datetime import datetime, time
from werkzeug.utils import secure_filename
from io import BytesIO, StringIO
import csv
import zipfile
import unicodedata
from uuid import UUID
import re
from ..repositories.work_card_repository import WorkCardRepository
from ..repositories.work_card_file_repository import WorkCardFileRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from ..repositories.work_card_day_entry_repository import WorkCardDayEntryRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required
from ..extensions import db
from ..models.sites import Site

work_cards_bp = Blueprint('work_cards', __name__, url_prefix='/api/work_cards')
repo = WorkCardRepository()
file_repo = WorkCardFileRepository()
extraction_repo = WorkCardExtractionRepository()
day_entry_repo = WorkCardDayEntryRepository()

@work_cards_bp.route('', methods=['GET'])
@token_required
def get_work_cards():
    """Get work cards in the current business, filtered by site+month or status."""
    site_id = request.args.get('site_id')
    month_str = request.args.get('month') # YYYY-MM-DD
    status = request.args.get('status')
    include_employee = request.args.get('include_employee', 'false').lower() == 'true'
    
    if site_id and month_str:
        try:
            month = datetime.strptime(month_str, '%Y-%m-%d').date()
            if include_employee:
                results = repo.get_by_site_month_with_employee(site_id, month, business_id=g.business_id)
            else:
                results = repo.get_by_site_month(site_id, month, business_id=g.business_id)
        except ValueError:
            return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")
    elif status:
        results = repo.get_by_review_status(status, business_id=g.business_id)
    else:
        results = repo.get_all_for_business(business_id=g.business_id)
    
    # Serialize results with optional employee data
    data = []
    for card in results:
        card_dict = model_to_dict(card)
        if include_employee and hasattr(card, 'employee') and card.employee:
            card_dict['employee'] = model_to_dict(card.employee)
        data.append(card_dict)
        
    return api_response(data=data)

@work_cards_bp.route('/<uuid:card_id>', methods=['GET'])
@token_required
def get_work_card(card_id):
    """Get a specific work card (must belong to current business), optionally with details."""
    include_details = request.args.get('details', 'false').lower() == 'true'
    
    if include_details:
        card = repo.get_with_all_relations(card_id)
    else:
        card = repo.get_by_id(card_id)
    
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = model_to_dict(card)
    
    # Handle relationships if loaded
    if include_details:
        if card.extraction:
            data['extraction'] = model_to_dict(card.extraction)
        if card.day_entries:
            data['day_entries'] = models_to_list(card.day_entries)
        if card.files:
            data['files'] = models_to_list(card.files)
            
    return api_response(data=data)

@work_cards_bp.route('/<uuid:card_id>', methods=['PUT'])
@token_required
def update_work_card(card_id):
    """Update a work card (must belong to current business, e.g. assign employee)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    
    # Prevent changing business_id
    if 'business_id' in data:
        del data['business_id']
        
    try:
        updated_card = repo.update(card_id, **data)
        if not updated_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_card), message="Work card updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/status', methods=['PUT'])
@token_required
def update_status(card_id):
    """Update review status (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    status = data.get('status')
    
    if not status:
         return api_response(status_code=400, message="Status is required", error="Bad Request")
         
    try:
        updated_card = repo.update_review_status(card_id, status)
        if not updated_card:
             return api_response(status_code=404, message="Work card not found", error="Not Found")
             
        return api_response(data=model_to_dict(updated_card), message="Status updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update status", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/approve', methods=['POST'])
@token_required
def approve_work_card(card_id):
    """Approve a work card (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    user_id = data.get('user_id')
    
    if not user_id:
        return api_response(status_code=400, message="User ID is required for approval", error="Bad Request")
        
    try:
        approved_card = repo.approve_card(card_id, user_id, g.business_id)
        if not approved_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")
            
        return api_response(data=model_to_dict(approved_card), message="Work card approved successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to approve work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>', methods=['DELETE'])
@token_required
def delete_work_card(card_id):
    """Delete a work card (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        # Delete the card (cascade will handle related files/extractions/entries if configured,
        # but the models define cascade="all, delete-orphan", so SQLAlchemy should handle it
        # as long as we use session.delete(instance))
        success = repo.delete(card_id)
        if not success:
             return api_response(status_code=404, message="Work card not found", error="Not Found")
             
        return api_response(message="Work card deleted successfully", status_code=200)
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/file', methods=['GET'])
@token_required
def get_work_card_file(card_id):
    """Get the image file for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    # Get the file
    file = file_repo.get_by_work_card(card_id)
    if not file:
        return api_response(status_code=404, message="File not found for this work card", error="Not Found")
    
    try:
        # Return the image bytes with proper content type
        return send_file(
            BytesIO(file.image_bytes),
            mimetype=file.content_type,
            as_attachment=False,
            download_name=file.file_name
        )
    except Exception as e:
        return api_response(status_code=500, message="Failed to retrieve file", error=str(e))

@work_cards_bp.route('/export', methods=['GET'])
@token_required
def export_work_cards():
    """Export work cards for a site and month as a ZIP file."""
    site_id = request.args.get('site_id')
    month_str = request.args.get('month') # YYYY-MM-DD
    status_str = request.args.get('status')
    employee_ids_str = request.args.get('employee_ids')
    include_unassigned = request.args.get('include_unassigned', 'true').lower() == 'true'
    include_metadata = request.args.get('include_metadata', 'true').lower() == 'true'
    include_day_entries = request.args.get('include_day_entries', 'false').lower() == 'true'

    if not site_id or not month_str:
        return api_response(status_code=400, message="site_id and month are required", error="Bad Request")

    try:
        month = datetime.strptime(month_str, '%Y-%m-%d').date()
    except ValueError:
        return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")

    def parse_list(value: str) -> list:
        if not value:
            return []
        return [item.strip() for item in value.split(',') if item.strip()]

    statuses = parse_list(status_str)
    employee_ids = parse_list(employee_ids_str)

    # Convert to UUIDs where possible
    parsed_employee_ids = []
    for emp_id in employee_ids:
        try:
            parsed_employee_ids.append(UUID(emp_id))
        except ValueError:
            return api_response(status_code=400, message="Invalid employee_id format", error="Bad Request")

    cards = repo.get_for_export(
        site_id=site_id,
        month=month,
        business_id=g.business_id,
        statuses=statuses if statuses else None,
        employee_ids=parsed_employee_ids if parsed_employee_ids else None,
        include_unassigned=include_unassigned,
        include_employee=True,
        include_day_entries=include_day_entries
    )

    def safe_label(value: str) -> str:
        if not value:
            return ''
        # Normalize and keep unicode letters/numbers, replace the rest with underscore
        normalized = unicodedata.normalize('NFKC', value)
        cleaned = []
        for ch in normalized:
            cat = unicodedata.category(ch)
            if cat[0] in {'L', 'N'}:
                cleaned.append(ch)
            else:
                cleaned.append('_')
        label = ''.join(cleaned).strip('_')
        label = '_'.join(filter(None, label.split('_')))
        return label

    site = db.session.query(Site).filter_by(id=site_id, business_id=g.business_id).first()
    site_label = safe_label(site.site_name) if site else str(site_id)
    folder_name = f"{site_label}_{month.strftime('%Y-%m')}_work_cards"

    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
        metadata_rows = []
        day_entries_rows = []

        for card in cards:
            employee_folder = 'unassigned'
            employee_name = None
            employee_id = None
            if card.employee:
                employee_name = card.employee.full_name
                employee_id = str(card.employee.id)
                safe_name = safe_label(employee_name) or f"employee_{employee_id}"
                employee_folder = safe_name

            if card.files and card.files.image_bytes:
                original_name = card.files.file_name or card.original_filename or f"{card.id}"
                safe_original = secure_filename(original_name) or str(card.id)
                extension = ''
                if '.' in safe_original:
                    extension = f".{safe_original.rsplit('.', 1)[-1]}"

                employee_label = 'unassigned'
                if card.employee:
                    id_number = card.employee.passport_id or str(card.employee.id)
                    safe_employee = safe_label(card.employee.full_name) or str(card.employee.id)
                    safe_id_number = safe_label(id_number) or str(card.employee.id)
                    employee_label = f"{safe_employee}_{safe_id_number}"
                    file_name = f"{employee_label}{extension}"
                else:
                    file_name = f"unassigned_{card.id}{extension}"

                file_path = f"{folder_name}/{file_name}"
                zipf.writestr(file_path, card.files.image_bytes)

            if include_metadata:
                metadata_rows.append({
                    'work_card_id': str(card.id),
                    'site_id': str(card.site_id),
                    'employee_id': employee_id,
                    'employee_name': employee_name,
                    'review_status': card.review_status,
                    'processing_month': str(card.processing_month),
                    'original_filename': card.original_filename,
                    'uploaded_at': card.created_at.isoformat() if card.created_at else None,
                    'approved_at': card.approved_at.isoformat() if card.approved_at else None,
                    'notes': card.notes
                })

            if include_day_entries and card.day_entries:
                for entry in card.day_entries:
                    day_entries_rows.append({
                        'work_card_id': str(card.id),
                        'employee_id': employee_id,
                        'day_of_month': entry.day_of_month,
                        'from_time': entry.from_time.isoformat() if entry.from_time else None,
                        'to_time': entry.to_time.isoformat() if entry.to_time else None,
                        'total_hours': str(entry.total_hours) if entry.total_hours is not None else None,
                        'is_valid': entry.is_valid
                    })

        if include_metadata:
            metadata_headers = [
                'work_card_id',
                'site_id',
                'employee_id',
                'employee_name',
                'review_status',
                'processing_month',
                'original_filename',
                'uploaded_at',
                'approved_at',
                'notes'
            ]
            metadata_csv = StringIO()
            writer = csv.DictWriter(metadata_csv, fieldnames=metadata_headers)
            writer.writeheader()
            writer.writerows(metadata_rows)
            zipf.writestr('metadata.csv', metadata_csv.getvalue().encode('utf-8'))

        if include_day_entries:
            day_entries_headers = [
                'work_card_id',
                'employee_id',
                'day_of_month',
                'from_time',
                'to_time',
                'total_hours',
                'is_valid'
            ]
            day_entries_csv = StringIO()
            writer = csv.DictWriter(day_entries_csv, fieldnames=day_entries_headers)
            writer.writeheader()
            writer.writerows(day_entries_rows)
            zipf.writestr('day_entries.csv', day_entries_csv.getvalue().encode('utf-8'))

    zip_buffer.seek(0)
    download_name = f"work_cards_{site_id}_{month.strftime('%Y-%m')}.zip"
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=download_name
    )

@work_cards_bp.route('/<uuid:card_id>/day-entries', methods=['GET'])
@token_required
def get_day_entries(card_id):
    """Get all day entries for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        entries = day_entry_repo.get_by_work_card(card_id)
        return api_response(data=models_to_list(entries))
    except Exception as e:
        return api_response(status_code=500, message="Failed to retrieve day entries", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/day-entries', methods=['PUT'])
@token_required
def update_day_entries(card_id):
    """Bulk update day entries for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    if not data or 'entries' not in data:
        return api_response(status_code=400, message="entries array is required", error="Bad Request")
    
    entries_data = data['entries']
    if not isinstance(entries_data, list):
        return api_response(status_code=400, message="entries must be an array", error="Bad Request")
    
    # Validation helper
    def validate_time_format(time_str):
        """Validate HH:MM format."""
        if time_str is None:
            return None
        if not isinstance(time_str, str):
            return False
        pattern = r'^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$'
        if not re.match(pattern, time_str):
            return False
        return time_str
    
    # Validate all entries first
    validation_errors = []
    for entry in entries_data:
        errors = {}
        
        # Validate day_of_month
        day = entry.get('day_of_month')
        if day is None:
            errors['day_of_month'] = 'day_of_month is required'
        elif not isinstance(day, int) or day < 1 or day > 31:
            errors['day_of_month'] = 'day_of_month must be between 1 and 31'
        
        # Validate from_time
        from_time = entry.get('from_time')
        if from_time is not None:
            validated = validate_time_format(from_time)
            if validated is False:
                errors['from_time'] = 'from_time must be in HH:MM format'
        
        # Validate to_time
        to_time = entry.get('to_time')
        if to_time is not None:
            validated = validate_time_format(to_time)
            if validated is False:
                errors['to_time'] = 'to_time must be in HH:MM format'
        
        # Validate total_hours
        total_hours = entry.get('total_hours')
        if total_hours is not None:
            try:
                float(total_hours)
            except (ValueError, TypeError):
                errors['total_hours'] = 'total_hours must be numeric'
        
        if errors:
            validation_errors.append({'day': day, 'errors': errors})
    
    if validation_errors:
        return api_response(
            status_code=400,
            message="Validation errors in entries",
            error="Bad Request",
            data={'validation_errors': validation_errors}
        )
    
    try:
        # Update or create entries
        updated_entries = []
        for entry in entries_data:
            day = entry['day_of_month']
            
            # Get existing entry for this day
            existing = day_entry_repo.get_by_day(card_id, day)
            
            # Parse time strings to time objects
            from_time_obj = None
            to_time_obj = None
            
            if entry.get('from_time'):
                hour, minute = map(int, entry['from_time'].split(':'))
                from_time_obj = time(hour, minute)
            
            if entry.get('to_time'):
                hour, minute = map(int, entry['to_time'].split(':'))
                to_time_obj = time(hour, minute)
            
            entry_data = {
                'from_time': from_time_obj,
                'to_time': to_time_obj,
                'total_hours': entry.get('total_hours'),
                'updated_by_user_id': g.current_user.id
            }
            
            if existing:
                # Update existing entry
                updated = day_entry_repo.update_entry(existing.id, g.current_user.id, **entry_data)
                updated_entries.append(updated)
            else:
                # Create new entry
                entry_data['work_card_id'] = card_id
                entry_data['day_of_month'] = day
                entry_data['source'] = 'MANUAL'
                new_entry = day_entry_repo.create(**entry_data)
                updated_entries.append(new_entry)
        
        return api_response(
            data=models_to_list(updated_entries),
            message="Day entries updated successfully"
        )
    except Exception as e:
        return api_response(status_code=500, message="Failed to update day entries", error=str(e))

@work_cards_bp.route('/upload/single', methods=['POST'])
@token_required
def upload_single():
    """Upload a single work card for a known employee."""
    # Define allowed MIME types
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }
    
    # Validate form data
    if 'file' not in request.files:
        return api_response(status_code=400, message="No file provided", error="Bad Request")
    
    file = request.files['file']
    if file.filename == '':
        return api_response(status_code=400, message="No file selected", error="Bad Request")
    
    # Validate MIME type
    content_type = file.content_type or 'application/octet-stream'
    if content_type not in ALLOWED_TYPES:
        return api_response(
            status_code=400, 
            message="סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד", 
            error="Invalid file type"
        )
    
    site_id = request.form.get('site_id')
    employee_id = request.form.get('employee_id')
    processing_month = request.form.get('processing_month')
    
    if not site_id or not employee_id or not processing_month:
        return api_response(status_code=400, message="site_id, employee_id, and processing_month are required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        # Read file data
        file_data = file.read()
        content_type = file.content_type or 'application/octet-stream'
        filename = secure_filename(file.filename)
        
        # Create work card
        work_card_data = {
            'business_id': g.business_id,
            'site_id': site_id,
            'employee_id': employee_id,
            'processing_month': month,
            'source': 'ADMIN_SINGLE',
            'uploaded_by_user_id': g.current_user.id,
            'original_filename': filename,
            'mime_type': content_type,
            'file_size_bytes': len(file_data),
            'review_status': 'NEEDS_REVIEW'
        }
        
        work_card = repo.create(**work_card_data)
        
        # Create work card file
        file_repo.create(
            work_card_id=work_card.id,
            content_type=content_type,
            file_name=filename,
            image_bytes=file_data
        )
        
        # Automatically trigger extraction
        extraction_repo.create(
            work_card_id=work_card.id,
            status='PENDING'
        )
        
        return api_response(
            data=model_to_dict(work_card),
            message="Work card uploaded successfully",
            status_code=201
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        return api_response(status_code=500, message="Failed to upload work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/extract', methods=['POST'])
@token_required
def trigger_extraction(card_id):
    """Trigger (or re-trigger) extraction for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        # Get existing extraction job
        extraction = extraction_repo.get_by_work_card(card_id)
        
        if extraction:
            # Reset existing job to PENDING (will be picked up by worker)
            extraction_repo.reset_job(extraction.id)
            extraction = extraction_repo.get_by_id(extraction.id)  # Refresh
            message = "Extraction re-triggered successfully"
        else:
            # Create new extraction job
            extraction = extraction_repo.create(
                work_card_id=card_id,
                status='PENDING'
            )
            message = "Extraction triggered successfully"
        
        return api_response(
            data=model_to_dict(extraction),
            message=message
        )
    except Exception as e:
        return api_response(status_code=500, message="Failed to trigger extraction", error=str(e))


@work_cards_bp.route('/<uuid:card_id>/extraction', methods=['GET'])
@token_required
def get_extraction_status(card_id):
    """Get the extraction status for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        extraction = extraction_repo.get_by_work_card(card_id)
        
        if not extraction:
            return api_response(status_code=404, message="No extraction found for this work card", error="Not Found")
        
        return api_response(data=model_to_dict(extraction))
    except Exception as e:
        return api_response(status_code=500, message="Failed to get extraction status", error=str(e))


@work_cards_bp.route('/upload/batch', methods=['POST'])
@token_required
def upload_batch():
    """Upload multiple work cards for unknown employees (bulk upload)."""
    # Define allowed MIME types
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }
    
    # Validate files
    if 'files' not in request.files:
        return api_response(status_code=400, message="No files provided", error="Bad Request")
    
    files = request.files.getlist('files')
    if not files or len(files) == 0:
        return api_response(status_code=400, message="No files selected", error="Bad Request")
    
    site_id = request.form.get('site_id')
    processing_month = request.form.get('processing_month')
    
    if not site_id or not processing_month:
        return api_response(status_code=400, message="site_id and processing_month are required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        uploaded = []
        failed = []
        
        for file in files:
            if file.filename == '':
                continue
            
            # Validate MIME type for each file
            content_type = file.content_type or 'application/octet-stream'
            if content_type not in ALLOWED_TYPES:
                failed.append({
                    'filename': file.filename,
                    'error': 'סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד'
                })
                continue
                
            try:
                # Read file data
                file_data = file.read()
                filename = secure_filename(file.filename)
                
                # Create work card (employee_id = NULL for unknown uploads)
                work_card_data = {
                    'business_id': g.business_id,
                    'site_id': site_id,
                    'employee_id': None,  # Unknown employee
                    'processing_month': month,
                    'source': 'ADMIN_BATCH',
                    'uploaded_by_user_id': g.current_user.id,
                    'original_filename': filename,
                    'mime_type': content_type,
                    'file_size_bytes': len(file_data),
                    'review_status': 'NEEDS_ASSIGNMENT'
                }
                
                work_card = repo.create(**work_card_data)
                
                # Create work card file
                file_repo.create(
                    work_card_id=work_card.id,
                    content_type=content_type,
                    file_name=filename,
                    image_bytes=file_data
                )
                
                # Automatically trigger extraction
                extraction_repo.create(
                    work_card_id=work_card.id,
                    status='PENDING'
                )
                
                uploaded.append({
                    'filename': filename,
                    'work_card_id': str(work_card.id)
                })
            except Exception as e:
                failed.append({
                    'filename': file.filename,
                    'error': str(e)
                })
        
        return api_response(
            data={
                'uploaded': uploaded,
                'failed': failed,
                'summary': {
                    'total': len(files),
                    'uploaded': len(uploaded),
                    'failed': len(failed)
                }
            },
            message=f"Batch upload completed: {len(uploaded)} uploaded, {len(failed)} failed",
            status_code=201
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        return api_response(status_code=500, message="Failed to process batch upload", error=str(e))
