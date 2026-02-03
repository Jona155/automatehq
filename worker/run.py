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
from typing import Optional

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
from matcher import match_employee_by_passport

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
        
        # Run extraction (OpenCV + GPT-4o Vision)
        extraction_result = extract_from_image_bytes(image_bytes)
        
        if not extraction_result:
            extraction_repo.mark_failed(job_id, "Extraction returned no results")
            return False
        
        entries = extraction_result.get('entries', [])
        raw_result = extraction_result.get('raw_result', {})
        model_name = extraction_result.get('model_name', 'gpt-4o')
        
        logger.info(f"Extracted {len(entries)} day entries")
        
        # Match employee by passport (if passport ID was extracted)
        extracted_passport_id = extraction_result.get('extracted_passport_id')
        match_result = match_employee_by_passport(
            passport_id=extracted_passport_id,
            business_id=work_card.business_id,
            employee_repo=employee_repo
        )
        
        matched_employee_id = match_result.get('employee_id') if match_result else None
        match_method = match_result.get('method') if match_result else None
        match_confidence = match_result.get('confidence') if match_result else None
        
        if matched_employee_id:
            logger.info(f"Matched employee {matched_employee_id} via {match_method}")
        else:
            logger.info("No employee match found")
        
        # Create day entries
        day_entries_created = 0
        for entry in entries:
            day = entry.get('day')
            if day is None or day < 1 or day > 31:
                continue
            
            # Check if entry already exists for this day
            existing = day_entry_repo.get_by_day(job.work_card_id, day)
            if existing:
                logger.debug(f"Day {day} entry already exists, skipping")
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
        
        logger.info(f"Created {day_entries_created} day entries")
        
        # Update work card with matched employee (if found)
        if matched_employee_id and not work_card.employee_id:
            work_card_repo.update(work_card.id, employee_id=matched_employee_id)
            logger.info(f"Updated work card with matched employee {matched_employee_id}")
        
        # Update work card review status
        if matched_employee_id:
            new_status = 'NEEDS_REVIEW'
        else:
            new_status = 'NEEDS_ASSIGNMENT'
        work_card_repo.update_review_status(work_card.id, new_status, work_card.business_id)
        
        # Mark extraction as completed
        extraction_repo.mark_completed(job_id, {
            'extracted_employee_name': extraction_result.get('extracted_employee_name'),
            'extracted_passport_id': extracted_passport_id,
            'raw_result_jsonb': raw_result,
            'normalized_result_jsonb': {'entries': entries},
            'matched_employee_id': matched_employee_id,
            'match_method': match_method,
            'match_confidence': match_confidence,
            'model_name': model_name,
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
