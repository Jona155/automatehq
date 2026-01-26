from typing import Optional, List, Dict, Any
from uuid import UUID
from .base import BaseRepository
from ..models.audit import AuditEvent


class AuditEventRepository(BaseRepository[AuditEvent]):
    """Repository for AuditEvent model operations."""
    
    def __init__(self):
        super().__init__(AuditEvent)
    
    def log_event(
        self,
        event_type: str,
        entity_type: str,
        entity_id: UUID,
        actor_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
        site_id: Optional[UUID] = None,
        employee_id: Optional[UUID] = None,
        work_card_id: Optional[UUID] = None
    ) -> AuditEvent:
        """
        Create a new audit event.
        
        Args:
            event_type: Type of event (CREATE, UPDATE, DELETE, APPROVE, etc.)
            entity_type: Type of entity affected (WORK_CARD, EMPLOYEE, etc.)
            entity_id: UUID of the affected entity
            actor_id: UUID of the user performing the action
            metadata: Additional event metadata
            site_id: Optional site ID for filtering
            employee_id: Optional employee ID for filtering
            work_card_id: Optional work card ID for filtering
            
        Returns:
            The created AuditEvent instance
        """
        return self.create(
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_user_id=actor_id,
            event_metadata=metadata,
            site_id=site_id,
            employee_id=employee_id,
            work_card_id=work_card_id
        )
    
    def get_by_entity(self, entity_type: str, entity_id: UUID) -> List[AuditEvent]:
        """
        Get all audit events for a specific entity.
        
        Args:
            entity_type: Type of entity
            entity_id: UUID of the entity
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            entity_type=entity_type,
            entity_id=entity_id
        ).order_by(AuditEvent.created_at.desc()).all()
    
    def get_by_site(self, site_id: UUID, limit: int = 100) -> List[AuditEvent]:
        """
        Get recent audit events for a site.
        
        Args:
            site_id: The site's UUID
            limit: Maximum number of events to return
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            site_id=site_id
        ).order_by(AuditEvent.created_at.desc()).limit(limit).all()
    
    def get_by_actor(self, actor_id: UUID) -> List[AuditEvent]:
        """
        Get all events performed by a specific user.
        
        Args:
            actor_id: The user's UUID
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            actor_user_id=actor_id
        ).order_by(AuditEvent.created_at.desc()).all()
    
    def get_recent(self, limit: int = 50) -> List[AuditEvent]:
        """
        Get recent audit events across the system.
        
        Args:
            limit: Maximum number of events to return
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).order_by(
            AuditEvent.created_at.desc()
        ).limit(limit).all()
    
    def get_by_event_type(self, event_type: str, limit: int = 100) -> List[AuditEvent]:
        """
        Get audit events by event type.
        
        Args:
            event_type: The event type to filter by
            limit: Maximum number of events to return
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            event_type=event_type
        ).order_by(AuditEvent.created_at.desc()).limit(limit).all()
    
    def get_by_work_card(self, work_card_id: UUID) -> List[AuditEvent]:
        """
        Get all audit events related to a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            work_card_id=work_card_id
        ).order_by(AuditEvent.created_at.desc()).all()
    
    def get_by_employee(self, employee_id: UUID) -> List[AuditEvent]:
        """
        Get all audit events related to an employee.
        
        Args:
            employee_id: The employee's UUID
            
        Returns:
            List of AuditEvent instances, ordered by created_at descending
        """
        return self.session.query(AuditEvent).filter_by(
            employee_id=employee_id
        ).order_by(AuditEvent.created_at.desc()).all()
