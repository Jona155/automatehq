from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime, timedelta
from .base import BaseRepository
from ..models.work_cards import WorkCardExtraction
from ..utils import utc_now


class WorkCardExtractionRepository(BaseRepository[WorkCardExtraction]):
    """Repository for WorkCardExtraction model operations."""
    
    def __init__(self):
        super().__init__(WorkCardExtraction)
    
    def get_pending_jobs(self, limit: int = 10) -> List[WorkCardExtraction]:
        """
        Get pending extraction jobs that are not locked.
        
        Args:
            limit: Maximum number of jobs to return
            
        Returns:
            List of WorkCardExtraction instances with PENDING status
        """
        return self.session.query(WorkCardExtraction).filter_by(
            status='PENDING'
        ).filter(
            WorkCardExtraction.locked_at.is_(None)
        ).limit(limit).all()
    
    def claim_job(self, job_id: UUID, worker_id: str) -> bool:
        """
        Claim a job by locking it for a worker.
        Uses optimistic locking to prevent race conditions.
        
        Args:
            job_id: The extraction job's UUID
            worker_id: Identifier for the worker claiming the job
            
        Returns:
            True if job was successfully claimed, False otherwise
        """
        rows_updated = self.session.query(WorkCardExtraction).filter(
            WorkCardExtraction.id == job_id,
            WorkCardExtraction.locked_at.is_(None)
        ).update({
            'locked_at': utc_now(),
            'locked_by': worker_id
        }, synchronize_session=False)
        
        self.session.commit()
        return rows_updated > 0
    
    def mark_running(self, job_id: UUID) -> bool:
        """
        Mark a job as running.
        
        Args:
            job_id: The extraction job's UUID
            
        Returns:
            True if updated successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.status = 'RUNNING'
        job.started_at = utc_now()
        self.session.commit()
        return True
    
    def mark_completed(self, job_id: UUID, results: Dict[str, Any]) -> bool:
        """
        Mark a job as completed with results.
        
        Args:
            job_id: The extraction job's UUID
            results: Dict containing extraction results (employee_name, passport_id, etc.)
            
        Returns:
            True if updated successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.status = 'DONE'
        job.finished_at = utc_now()
        
        # Update extraction results
        if 'extracted_employee_name' in results:
            job.extracted_employee_name = results['extracted_employee_name']
        if 'extracted_passport_id' in results:
            job.extracted_passport_id = results['extracted_passport_id']
        if 'raw_result_jsonb' in results:
            job.raw_result_jsonb = results['raw_result_jsonb']
        if 'normalized_result_jsonb' in results:
            job.normalized_result_jsonb = results['normalized_result_jsonb']
        if 'matched_employee_id' in results:
            job.matched_employee_id = results['matched_employee_id']
        if 'match_method' in results:
            job.match_method = results['match_method']
        if 'match_confidence' in results:
            job.match_confidence = results['match_confidence']
        if 'model_name' in results:
            job.model_name = results['model_name']
        if 'model_version' in results:
            job.model_version = results['model_version']
        if 'pipeline_version' in results:
            job.pipeline_version = results['pipeline_version']
        
        self.session.commit()
        return True
    
    def mark_failed(self, job_id: UUID, error: str) -> bool:
        """
        Mark a job as failed with an error message.
        
        Args:
            job_id: The extraction job's UUID
            error: Error message describing the failure
            
        Returns:
            True if updated successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.status = 'FAILED'
        job.finished_at = utc_now()
        job.last_error = error
        self.session.commit()
        return True
    
    def get_by_status(self, status: str) -> List[WorkCardExtraction]:
        """
        Get all extraction jobs with a specific status.
        
        Args:
            status: The status (PENDING, RUNNING, DONE, FAILED)
            
        Returns:
            List of WorkCardExtraction instances
        """
        return self.session.query(WorkCardExtraction).filter_by(status=status).all()
    
    def get_by_work_card(self, work_card_id: UUID) -> Optional[WorkCardExtraction]:
        """
        Get the extraction job for a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            WorkCardExtraction instance or None if not found
        """
        return self.session.query(WorkCardExtraction).filter_by(
            work_card_id=work_card_id
        ).first()
    
    def increment_attempts(self, job_id: UUID) -> bool:
        """
        Increment the attempts counter for a job.
        
        Args:
            job_id: The extraction job's UUID
            
        Returns:
            True if updated successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.attempts += 1
        self.session.commit()
        return True
    
    def get_stale_locks(self, minutes: int = 30) -> List[WorkCardExtraction]:
        """
        Get jobs with stale locks (locked but not updated recently).
        Useful for recovering from worker crashes.
        
        Args:
            minutes: Number of minutes after which a lock is considered stale
            
        Returns:
            List of WorkCardExtraction instances with stale locks
        """
        cutoff_time = utc_now() - timedelta(minutes=minutes)
        
        return self.session.query(WorkCardExtraction).filter(
            WorkCardExtraction.locked_at.isnot(None),
            WorkCardExtraction.locked_at < cutoff_time,
            WorkCardExtraction.status.in_(['PENDING', 'RUNNING'])
        ).all()
    
    def release_lock(self, job_id: UUID) -> bool:
        """
        Release a job lock.
        
        Args:
            job_id: The extraction job's UUID
            
        Returns:
            True if released successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.locked_at = None
        job.locked_by = None
        self.session.commit()
        return True
    
    def reset_job(self, job_id: UUID) -> bool:
        """
        Reset a job to PENDING state (for retry).
        
        Args:
            job_id: The extraction job's UUID
            
        Returns:
            True if reset successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False
        
        job.status = 'PENDING'
        job.locked_at = None
        job.locked_by = None
        job.started_at = None
        job.finished_at = None
        self.session.commit()
        return True
    
    def reset_job_hours_only(self, job_id: UUID) -> bool:
        """
        Reset a job to PENDING state in HOURS_ONLY mode (re-extract day entries, skip identity matching).

        Returns:
            True if reset successfully, False if job not found
        """
        job = self.get_by_id(job_id)
        if not job:
            return False

        job.status = 'PENDING'
        job.extraction_mode = 'HOURS_ONLY'
        job.locked_at = None
        job.locked_by = None
        job.started_at = None
        job.finished_at = None
        self.session.commit()
        return True

    def get_failed_jobs_for_retry(self, max_attempts: int = 3) -> List[WorkCardExtraction]:
        """
        Get failed jobs that haven't exceeded max retry attempts.
        
        Args:
            max_attempts: Maximum number of attempts before giving up
            
        Returns:
            List of WorkCardExtraction instances that can be retried
        """
        return self.session.query(WorkCardExtraction).filter(
            WorkCardExtraction.status == 'FAILED',
            WorkCardExtraction.attempts < max_attempts
        ).all()
