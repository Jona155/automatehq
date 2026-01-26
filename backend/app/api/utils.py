from typing import Any, Dict, List, Optional, Union
from flask import jsonify
from sqlalchemy.orm import class_mapper

def model_to_dict(model: Any) -> Dict[str, Any]:
    """
    Convert a SQLAlchemy model instance to a dictionary.
    """
    if not model:
        return None
    
    # Get all columns
    columns = [c.key for c in class_mapper(model.__class__).columns]
    data = {}
    for c in columns:
        value = getattr(model, c)
        # Handle UUID and DateTime serialization
        if hasattr(value, 'isoformat'):  # DateTime
            data[c] = value.isoformat()
        elif hasattr(value, '__class__') and value.__class__.__name__ == 'UUID':
            data[c] = str(value)
        else:
            data[c] = value
    return data

def models_to_list(models: List[Any]) -> List[Dict[str, Any]]:
    """
    Convert a list of SQLAlchemy model instances to a list of dictionaries.
    """
    return [model_to_dict(m) for m in models]

def api_response(
    data: Any = None, 
    message: str = "Success", 
    status_code: int = 200, 
    error: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
):
    """
    Standard API response format.
    """
    response = {
        "success": status_code >= 200 and status_code < 300,
        "message": message,
        "data": data
    }
    
    if error:
        response["error"] = error
        
    if meta:
        response["meta"] = meta
        
    return jsonify(response), status_code
