from typing import TypeVar, Generic, Type, Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError
from ..extensions import db

T = TypeVar('T')


class BaseRepository(Generic[T]):
    """
    Base repository class providing common CRUD operations for all models.
    Uses generics for type safety.
    """
    
    def __init__(self, model_class: Type[T]):
        self.model_class = model_class
        self.session = db.session
    
    def create(self, **kwargs) -> T:
        """
        Create a new instance of the model.
        
        Args:
            **kwargs: Fields to set on the model
            
        Returns:
            The created model instance
            
        Raises:
            SQLAlchemyError: If database operation fails
        """
        try:
            instance = self.model_class(**kwargs)
            self.session.add(instance)
            self.session.commit()
            return instance
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def get_by_id(self, id: UUID) -> Optional[T]:
        """
        Get a model instance by its ID.
        
        Args:
            id: The UUID of the instance
            
        Returns:
            The model instance or None if not found
        """
        return self.session.query(self.model_class).filter_by(id=id).first()
    
    def get_all(self, filters: Optional[Dict[str, Any]] = None) -> List[T]:
        """
        Get all instances, optionally filtered.
        
        Args:
            filters: Dict of field names to values for filtering
            
        Returns:
            List of model instances
        """
        query = self.session.query(self.model_class)
        
        if filters:
            query = query.filter_by(**filters)
        
        return query.all()
    
    def update(self, id: UUID, **kwargs) -> Optional[T]:
        """
        Update an existing model instance.
        
        Args:
            id: The UUID of the instance to update
            **kwargs: Fields to update
            
        Returns:
            The updated instance or None if not found
            
        Raises:
            SQLAlchemyError: If database operation fails
        """
        try:
            instance = self.get_by_id(id)
            if not instance:
                return None
            
            for key, value in kwargs.items():
                if hasattr(instance, key):
                    setattr(instance, key, value)
            
            self.session.commit()
            return instance
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def delete(self, id: UUID) -> bool:
        """
        Delete a model instance by ID.
        
        Args:
            id: The UUID of the instance to delete
            
        Returns:
            True if deleted, False if not found
            
        Raises:
            SQLAlchemyError: If database operation fails
        """
        try:
            instance = self.get_by_id(id)
            if not instance:
                return False
            
            self.session.delete(instance)
            self.session.commit()
            return True
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def exists(self, id: UUID) -> bool:
        """
        Check if an instance exists by ID.
        
        Args:
            id: The UUID of the instance
            
        Returns:
            True if exists, False otherwise
        """
        return self.session.query(
            self.session.query(self.model_class).filter_by(id=id).exists()
        ).scalar()
    
    def get_paginated(
        self, 
        page: int = 1, 
        per_page: int = 20, 
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Get paginated results.
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            filters: Dict of field names to values for filtering
            
        Returns:
            Dict with 'items', 'total', 'page', 'per_page', 'pages'
        """
        query = self.session.query(self.model_class)
        
        if filters:
            query = query.filter_by(**filters)
        
        total = query.count()
        pages = (total + per_page - 1) // per_page
        
        items = query.offset((page - 1) * per_page).limit(per_page).all()
        
        return {
            'items': items,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': pages
        }
    
    def create_many(self, items: List[Dict[str, Any]]) -> List[T]:
        """
        Create multiple instances in bulk.
        
        Args:
            items: List of dicts with model fields
            
        Returns:
            List of created instances
            
        Raises:
            SQLAlchemyError: If database operation fails
        """
        try:
            instances = [self.model_class(**item) for item in items]
            self.session.add_all(instances)
            self.session.commit()
            return instances
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def delete_many(self, ids: List[UUID]) -> int:
        """
        Delete multiple instances by IDs.
        
        Args:
            ids: List of UUIDs to delete
            
        Returns:
            Number of instances deleted
            
        Raises:
            SQLAlchemyError: If database operation fails
        """
        try:
            count = self.session.query(self.model_class).filter(
                self.model_class.id.in_(ids)
            ).delete(synchronize_session=False)
            self.session.commit()
            return count
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def commit(self) -> None:
        """Commit the current transaction."""
        try:
            self.session.commit()
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
    
    def rollback(self) -> None:
        """Rollback the current transaction."""
        self.session.rollback()
    
    def flush(self) -> None:
        """Flush pending changes without committing."""
        try:
            self.session.flush()
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
