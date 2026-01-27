"""
Business Context Helper

Provides utilities to access the current business and user context
from Flask's g object (set by the token_required decorator).
"""
from flask import g
from uuid import UUID
from typing import Optional


def get_current_business_id() -> UUID:
    """
    Get the business_id from the current request context.
    
    Returns:
        UUID: The current user's business_id
        
    Raises:
        RuntimeError: If no business context is available (user not authenticated)
    """
    if not hasattr(g, 'business_id'):
        raise RuntimeError("No business context available. Ensure the route is protected with @token_required")
    return g.business_id


def get_current_user():
    """
    Get the current user from the request context.
    
    Returns:
        User: The current authenticated user
        
    Raises:
        RuntimeError: If no user context is available (user not authenticated)
    """
    if not hasattr(g, 'current_user'):
        raise RuntimeError("No user context available. Ensure the route is protected with @token_required")
    return g.current_user


def try_get_business_id() -> Optional[UUID]:
    """
    Safely attempt to get the business_id from context.
    
    Returns:
        UUID or None: The business_id if available, None otherwise
    """
    return getattr(g, 'business_id', None)


def try_get_current_user():
    """
    Safely attempt to get the current user from context.
    
    Returns:
        User or None: The current user if available, None otherwise
    """
    return getattr(g, 'current_user', None)
