from flask import Blueprint, request
from ..repositories.employee_repository import EmployeeRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

employees_bp = Blueprint('employees', __name__, url_prefix='/api/employees')
repo = EmployeeRepository()

@employees_bp.route('', methods=['GET'])
@token_required
def get_employees():
    """Get all employees, optionally filtered by site, name, or active status."""
    site_id = request.args.get('site_id')
    name_query = request.args.get('name')
    only_active = request.args.get('active', 'false').lower() == 'true'
    
    if name_query:
        results = repo.search_by_name(name_query, site_id)
        # Filter for active if requested
        if only_active:
            results = [e for e in results if e.is_active]
    elif site_id:
        if only_active:
            results = repo.get_active_by_site(site_id)
        else:
            results = repo.get_by_site(site_id)
    else:
        if only_active:
            results = repo.get_active_employees()
        else:
            results = repo.get_all()
            
    return api_response(data=models_to_list(results))

@employees_bp.route('', methods=['POST'])
@token_required
def create_employee():
    """Create a new employee."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Check passport uniqueness if provided
        if data.get('passport_id') and repo.get_by_passport(data['passport_id']):
             return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        employee = repo.create(**data)
        return api_response(data=model_to_dict(employee), message="Employee created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['GET'])
@token_required
def get_employee(employee_id):
    """Get a specific employee by ID."""
    employee = repo.get_by_id(employee_id)
    if not employee:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    return api_response(data=model_to_dict(employee))

@employees_bp.route('/<uuid:employee_id>', methods=['PUT'])
@token_required
def update_employee(employee_id):
    """Update an employee."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Check passport uniqueness if provided and changed
        if data.get('passport_id'):
            existing = repo.get_by_passport(data['passport_id'])
            if existing and str(existing.id) != str(employee_id):
                return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        updated_employee = repo.update(employee_id, **data)
        if not updated_employee:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_employee), message="Employee updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['DELETE'])
@token_required
def delete_employee(employee_id):
    """Delete an employee."""
    try:
        success = repo.delete(employee_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deleted successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/deactivate', methods=['POST'])
@token_required
def deactivate_employee(employee_id):
    """Deactivate an employee."""
    try:
        success = repo.deactivate(employee_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/activate', methods=['POST'])
@token_required
def activate_employee(employee_id):
    """Activate an employee."""
    try:
        success = repo.activate(employee_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate employee", error=str(e))
