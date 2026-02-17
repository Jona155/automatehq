"""
Extraction worker — polls for PENDING jobs, runs OpenCV + OpenAI Vision, saves results.

Usage:
    python worker/run.py

Environment variables:
    DATABASE_URL - PostgreSQL connection string
    OPENAI_API_KEY - OpenAI API key
    WORKER_POLL_SECONDS - Polling interval (default: 5)
    WORKER_ID - Unique worker identifier (default: auto-generated)
    MAX_RETRY_ATTEMPTS - Max retries per job (default: 3)
    STALE_LOCK_MINUTES - Minutes before lock is considered stale (default: 30)
"""
import os
import sys
import time
import uuid
import logging
import traceback
from datetime import time as dt_time
from typing import Optional, Any, Dict, Tuple

# Load env before any other imports
from dotenv import load_dotenv
load_dotenv()

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from flask import Flask
from app.extensions import db
from app.repositories import (
    WorkCardExtractionRepository,
    WorkCardFileRepository,
    WorkCardDayEntryRepository,
    WorkCardRepository,
    EmployeeRepository,
)

from extractor import extract_from_image_bytes, PIPELINE_VERSION
from matcher import match_employee, diagnose_identity_mismatch

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('extraction_worker')

# Configuration
POLL_INTERVAL = int(os.environ.get("WORKER_POLL_SECONDS", "5"))
WORKER_ID = os.environ.get("WORKER_ID", f"worker-{uuid.uuid4().hex[:8]}")
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
STALE_LOCK_MINUTES = int(os.environ.get("STALE_LOCK_MINUTES", "30"))


def create_worker_app() -> Flask:
    """Create a minimal Flask app for database access."""
    app = Flask(__name__)
    # Heroku provides postgres:// but SQLAlchemy 1.4+ requires postgresql://
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/automatehq"
    )
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    return app


def parse_time(time_str: Optional[str]) -> Optional[dt_time]:
    """Parse HH:MM string to time object."""
    if not time_str:
        return None
    try:
        parts = time_str.split(':')
        if len(parts) >= 2:
            hour = int(parts[0])
            minute = int(parts[1])
            return dt_time(hour=hour, minute=minute)
    except (ValueError, TypeError):
        pass
    return None


def _normalized_entry_values(
    from_time: Optional[Any],
    to_time: Optional[Any],
    total_hours: Optional[Any]
) -> Tuple[Optional[str], Optional[str], Optional[float]]:
    """Normalize day entry values for reliable comparisons."""
    def normalize_time(value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        if hasattr(value, 'hour') and hasattr(value, 'minute'):
            return f"{int(value.hour):02d}:{int(value.minute):02d}"
        raw = str(value).strip()
        if not raw:
            return None
        parts = raw.split(':')
        if len(parts) < 2:
            return raw
        try:
            return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
        except ValueError:
            return raw

    def normalize_hours(value: Optional[Any]) -> Optional[float]:
        if value is None or value == '':
            return None
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return None

    return (
        normalize_time(from_time),
        normalize_time(to_time),
        normalize_hours(total_hours),
    )


def _entry_differs_from_previous(extracted_entry: Dict[str, Any], previous_entry: Any) -> bool:
    """Return True when extracted day values differ from previous card values."""
    new_values = _normalized_entry_values(
        parse_time(extracted_entry.get('start_time')),
        parse_time(extracted_entry.get('end_time')),
        extracted_entry.get('total_hours'),
    )
    prev_values = _normalized_entry_values(
        previous_entry.from_time,
        previous_entry.to_time,
        previous_entry.total_hours,
    )
    return new_values != prev_values


def process_job(
    extraction_repo: WorkCardExtractionRepository,
    file_repo: WorkCardFileRepository,
    day_entry_repo: WorkCardDayEntryRepository,
    work_card_repo: WorkCardRepository,
    employee_repo: EmployeeRepository,
    job_id: uuid.UUID
) -> bool:
    """
    Process a single extraction job.
    
    Returns:
        True if processing succeeded, False otherwise
    """
    logger.info(f"Processing job {job_id}")
    
    try:
        # Get job details
        job = extraction_repo.get_by_id(job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return False
        
        # Mark as running
        extraction_repo.mark_running(job_id)
        extraction_repo.increment_attempts(job_id)
        
        # Get work card and image bytes
        work_card = work_card_repo.get_by_id(job.work_card_id)
        if not work_card:
            extraction_repo.mark_failed(job_id, "Work card not found")
            return False
        
        image_bytes = file_repo.get_image_bytes(job.work_card_id)
        if not image_bytes:
            extraction_repo.mark_failed(job_id, "Image file not found")
            return False
        
        logger.info(f"Fetched image ({len(image_bytes)} bytes) for work card {job.work_card_id}")
        
        # Run extraction (OpenCV + OpenAI Vision)
        extraction_result = extract_from_image_bytes(image_bytes)
        
        if not extraction_result:
            extraction_repo.mark_failed(job_id, "Extraction returned no results")
            return False
        
        entries = extraction_result.get('entries', [])
        raw_result = extraction_result.get('raw_result', {})
        model_name = extraction_result.get('model_name', 'gpt-5')
        fallback_used = extraction_result.get('fallback_used', False)
        
        logger.info(f"Extracted {len(entries)} day entries")
        
        # Match employee by normalized passport with candidate + optional name/site fallback
        extracted_passport_id = extraction_result.get('extracted_passport_id')
        normalized_passport_candidates = extraction_result.get('normalized_passport_candidates') or []
        match_result = match_employee(
            passport_id=extracted_passport_id,
            passport_candidates=normalized_passport_candidates,
            business_id=work_card.business_id,
            employee_repo=employee_repo,
            employee_name=extraction_result.get('extracted_employee_name'),
            site_id=work_card.site_id,
            enable_name_site_fallback=(os.environ.get('ENABLE_NAME_SITE_MATCH_FALLBACK', 'false').lower() == 'true'),
        )
        
        matched_employee_id = match_result.get('employee_id') if match_result else None
        match_method = match_result.get('method') if match_result else None
        match_confidence = match_result.get('confidence') if match_result else None
        match_is_exact = match_result.get('is_exact') if match_result else None
        matched_normalized_passport_id = match_result.get('normalized_passport_id') if match_result else None
        
        if matched_employee_id:
            logger.info(f"Matched employee {matched_employee_id} via {match_method}")
        else:
            logger.info("No employee match found")

        effective_employee_id = work_card.employee_id or matched_employee_id
        previous_entries_by_day = {}
        if effective_employee_id:
            previous_card = work_card_repo.get_previous_card_for_employee_month(
                employee_id=effective_employee_id,
                month=work_card.processing_month,
                business_id=work_card.business_id,
                current_card_id=work_card.id,
                site_id=work_card.site_id,
                include_day_entries=True
            )
            if previous_card:
                previous_entries_by_day = {entry.day_of_month: entry for entry in previous_card.day_entries}
                logger.info(
                    f"Comparing against previous card {previous_card.id} "
                    f"with {len(previous_entries_by_day)} day entries"
                )
        
        # Identity diagnostics for assigned employee vs extracted passport
        identity_mismatch = False
        identity_reason = None
        if work_card.employee_id:
            assigned_employee = employee_repo.get_by_id(work_card.employee_id)
            assigned_passport_id = assigned_employee.passport_id if assigned_employee else None
            identity_diagnostics = diagnose_identity_mismatch(
                assigned_passport_id=assigned_passport_id,
                extracted_passport_id=extracted_passport_id,
            )
            identity_mismatch = identity_diagnostics['identity_mismatch']
            identity_reason = identity_diagnostics['identity_reason']

            if identity_mismatch:
                logger.warning(
                    f"IDENTITY MISMATCH for work card {work_card.id}: "
                    f"assigned='{assigned_passport_id}' extracted='{extracted_passport_id}' "
                    f"reason={identity_reason}"
                )
            else:
                logger.info(
                    f"Identity validation for work card {work_card.id}: reason={identity_reason}"
                )
        
        # Create day entries incrementally: add only new/different slots.
        day_entries_created = 0
        day_entries_skipped_as_duplicate = 0
        for entry in entries:
            day = entry.get('day')
            if day is None or day < 1 or day > 31:
                continue
            
            # Check if entry already exists for this day
            existing = day_entry_repo.get_by_day(job.work_card_id, day)
            if existing:
                logger.debug(f"Day {day} entry already exists, skipping")
                continue

            previous_entry = previous_entries_by_day.get(day)
            if previous_entry and not _entry_differs_from_previous(entry, previous_entry):
                day_entries_skipped_as_duplicate += 1
                logger.debug(f"Day {day} duplicates previous card, skipping")
                continue
            
            try:
                day_entry_repo.create(
                    work_card_id=job.work_card_id,
                    day_of_month=day,
                    from_time=parse_time(entry.get('start_time')),
                    to_time=parse_time(entry.get('end_time')),
                    total_hours=entry.get('total_hours'),
                    source='EXTRACTED',
                    is_valid=True
                )
                day_entries_created += 1
            except Exception as e:
                logger.warning(f"Failed to create day entry for day {day}: {e}")
        
        logger.info(
            f"Created {day_entries_created} day entries "
            f"(skipped {day_entries_skipped_as_duplicate} duplicates)"
        )
        
        # Update work card with matched employee (if found and not already assigned)
        if matched_employee_id and not work_card.employee_id:
            work_card_repo.update(work_card.id, employee_id=matched_employee_id)
            logger.info(f"Updated work card with matched employee {matched_employee_id}")
        
        # Update work card review status
        # - If employee is already assigned (single upload) -> NEEDS_REVIEW
        # - If matched via extraction (batch upload) -> NEEDS_REVIEW
        # - If no employee assigned and no match -> NEEDS_ASSIGNMENT
        if work_card.employee_id or matched_employee_id:
            new_status = 'NEEDS_REVIEW'
        else:
            new_status = 'NEEDS_ASSIGNMENT'
        work_card_repo.update_review_status(work_card.id, new_status, work_card.business_id)
        
        # Mark extraction as completed
        # Include identity_mismatch flag in normalized_result for frontend warning display
        extraction_repo.mark_completed(job_id, {
            'extracted_employee_name': extraction_result.get('extracted_employee_name'),
            'extracted_passport_id': extracted_passport_id,
            'raw_result_jsonb': raw_result,
            'normalized_result_jsonb': {
                'entries': entries,
                'identity_mismatch': identity_mismatch,
                'identity_reason': identity_reason,
                'match_is_exact': match_is_exact,
                'matched_normalized_passport_id': matched_normalized_passport_id,
            },
            'matched_employee_id': matched_employee_id,
            'match_method': match_method,
            'match_confidence': match_confidence,
            'model_name': model_name,
            'fallback_used': fallback_used,
            'pipeline_version': PIPELINE_VERSION,
        })
        
        logger.info(f"Job {job_id} completed successfully")
        return True
        
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        logger.error(f"Job {job_id} failed: {error_msg}")
        logger.error(traceback.format_exc())
        
        try:
            extraction_repo.mark_failed(job_id, error_msg)
        except Exception as mark_err:
            logger.error(f"Failed to mark job as failed: {mark_err}")
        
        return False


def recover_stale_locks(extraction_repo: WorkCardExtractionRepository) -> int:
    """
    Recover jobs with stale locks (worker crashed mid-processing).
    
    Returns:
        Number of jobs recovered
    """
    stale_jobs = extraction_repo.get_stale_locks(minutes=STALE_LOCK_MINUTES)
    recovered = 0
    
    for job in stale_jobs:
        if job.attempts >= MAX_RETRY_ATTEMPTS:
            # Max retries exceeded, mark as failed
            logger.warning(f"Job {job.id} exceeded max attempts ({job.attempts}), marking failed")
            extraction_repo.mark_failed(job.id, f"Max retry attempts ({MAX_RETRY_ATTEMPTS}) exceeded")
        else:
            # Reset job for retry
            logger.info(f"Recovering stale job {job.id} (locked at {job.locked_at})")
            extraction_repo.reset_job(job.id)
            recovered += 1
    
    return recovered


def main_loop(app: Flask):
    """Main polling loop."""
    logger.info(f"Worker {WORKER_ID} starting...")
    logger.info(f"Poll interval: {POLL_INTERVAL}s, Max retries: {MAX_RETRY_ATTEMPTS}")
    
    with app.app_context():
        # Initialize repositories
        extraction_repo = WorkCardExtractionRepository()
        file_repo = WorkCardFileRepository()
        day_entry_repo = WorkCardDayEntryRepository()
        work_card_repo = WorkCardRepository()
        employee_repo = EmployeeRepository()
        
        while True:
            try:
                # Recover any stale locks first
                recovered = recover_stale_locks(extraction_repo)
                if recovered:
                    logger.info(f"Recovered {recovered} stale jobs")
                
                # Get pending jobs
                pending_jobs = extraction_repo.get_pending_jobs(limit=1)
                
                if not pending_jobs:
                    logger.debug("No pending jobs found")
                    time.sleep(POLL_INTERVAL)
                    continue
                
                job = pending_jobs[0]
                logger.info(f"Found pending job {job.id}")
                
                # Try to claim the job (optimistic locking)
                claimed = extraction_repo.claim_job(job.id, WORKER_ID)
                
                if not claimed:
                    logger.info(f"Job {job.id} was claimed by another worker")
                    time.sleep(1)  # Brief pause before next poll
                    continue
                
                logger.info(f"Claimed job {job.id}")
                
                # Process the job
                success = process_job(
                    extraction_repo=extraction_repo,
                    file_repo=file_repo,
                    day_entry_repo=day_entry_repo,
                    work_card_repo=work_card_repo,
                    employee_repo=employee_repo,
                    job_id=job.id
                )
                
                if success:
                    logger.info(f"Job {job.id} processed successfully")
                else:
                    logger.warning(f"Job {job.id} processing failed")
                
                # Small delay before next iteration
                time.sleep(1)
                
            except KeyboardInterrupt:
                logger.info("Shutdown requested, exiting...")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                logger.error(traceback.format_exc())
                time.sleep(POLL_INTERVAL)


def main():
    """Entry point."""
    app = create_worker_app()
    main_loop(app)


if __name__ == "__main__":
    main()
