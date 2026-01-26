from typing import Optional
from uuid import UUID
from .base import BaseRepository
from ..models.work_cards import WorkCardFile


class WorkCardFileRepository(BaseRepository[WorkCardFile]):
    """Repository for WorkCardFile model operations."""
    
    def __init__(self):
        super().__init__(WorkCardFile)
    
    def get_by_work_card(self, work_card_id: UUID) -> Optional[WorkCardFile]:
        """
        Get the file associated with a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            WorkCardFile instance or None if not found
        """
        return self.session.query(WorkCardFile).filter_by(
            work_card_id=work_card_id
        ).first()
    
    def get_image_bytes(self, work_card_id: UUID) -> Optional[bytes]:
        """
        Get just the image bytes for a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            Image bytes or None if not found
        """
        file = self.get_by_work_card(work_card_id)
        return file.image_bytes if file else None
    
    def delete_by_work_card(self, work_card_id: UUID) -> bool:
        """
        Delete the file associated with a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            True if deleted, False if not found
        """
        file = self.get_by_work_card(work_card_id)
        if not file:
            return False
        
        self.session.delete(file)
        self.session.commit()
        return True
    
    def get_file_info(self, work_card_id: UUID) -> Optional[dict]:
        """
        Get file metadata without the image bytes (for performance).
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            Dict with file metadata or None if not found
        """
        file = self.session.query(
            WorkCardFile.id,
            WorkCardFile.work_card_id,
            WorkCardFile.content_type,
            WorkCardFile.file_name,
            WorkCardFile.file_size_bytes,
            WorkCardFile.created_at
        ).filter_by(work_card_id=work_card_id).first()
        
        if not file:
            return None
        
        return {
            'id': file.id,
            'work_card_id': file.work_card_id,
            'content_type': file.content_type,
            'file_name': file.file_name,
            'file_size_bytes': file.file_size_bytes,
            'created_at': file.created_at
        }
