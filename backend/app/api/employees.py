from flask import Blueprint, request, g
from ..repositories.employee_repository import EmployeeRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

employees_bp = Blueprint('employees', __name__, url_prefix='/api/employees')
repo = EmployeeRepository()

@employees_bp.route('', methods=['GET'])
@token_required
def get_employees():
    """Get all employees, optionally filtered by site, name, or active status, scoped to tenant."""
    site_id = request.args.get('site_id')
    name_query = request.args.get('name')
    only_active = request.args.get('active', 'false').lower() == 'true'
    
    # Always scope to current business
    filters = {'business_id': g.current_user.business_id}
    
    if site_id:
        filters['site_id'] = site_id
    if only_active:
        filters['is_active'] = True
    
    if name_query:
        # For name search, we need special handling
        results = repo.search_by_name(name_query, site_id)
        # Filter by business_id and active status manually
        results = [e for e in results if e.business_id == g.current_user.business_id]
        if only_active:
            results = [e for e in results if e.is_active]
    else:
        results = repo.get_all(filters=filters)
            
    return api_response(data=models_to_list(results))

@employees_bp.route('', methods=['POST'])
@token_required
def create_employee():
    """Create a new employee, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Enforce tenant scoping
        data['business_id'] = g.current_user.business_id
        
        # Validation
        if not data.get('full_name'):
            return api_response(status_code=400, message="Full name is required", error="Bad Request")
        if not data.get('passport_id'):
            return api_response(status_code=400, message="Passport ID is required", error="Bad Request")
        if not data.get('phone_number'):
            return api_response(status_code=400, message="Phone number is required", error="Bad Request")
        if not data.get('site_id'):
            return api_response(status_code=400, message="Site is required", error="Bad Request")
        
        # Check passport uniqueness within tenant
        existing = repo.get_by_passport(data['passport_id'])
        if existing and existing.business_id == g.current_user.business_id:
            return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        employee = repo.create(**data)
        return api_response(data=model_to_dict(employee), message="Employee created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['GET'])
@token_required
def get_employee(employee_id):
    """Get a specific employee by ID, scoped to tenant."""
    employee = repo.get_by_id(employee_id)
    
    # Validate tenant scoping
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    return api_response(data=model_to_dict(employee))

@employees_bp.route('/<uuid:employee_id>', methods=['PUT'])
@token_required
def update_employee(employee_id):
    """Update an employee, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    try:
        # Prevent changing business_id
        data.pop('business_id', None)
        
        # Check passport uniqueness within tenant if changed
        if data.get('passport_id'):
            existing = repo.get_by_passport(data['passport_id'])
            if existing and str(existing.id) != str(employee_id) and existing.business_id == g.current_user.business_id:
                return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        updated_employee = repo.update(employee_id, **data)
            
        return api_response(data=model_to_dict(updated_employee), message="Employee updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['DELETE'])
@token_required
def delete_employee(employee_id):
    """Delete an employee (soft delete), scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
    try:
        success = repo.deactivate(employee_id)  # Soft delete via deactivation
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deleted successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/deactivate', methods=['POST'])
@token_required
def deactivate_employee(employee_id):
    """Deactivate an employee, scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
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
    """Activate an employee, scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
    try:
        success = repo.activate(employee_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate employee", error=str(e))
