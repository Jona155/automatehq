from flask import Blueprint, request, g
from ..repositories.employee_repository import EmployeeRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

employees_bp = Blueprint('employees', __name__, url_prefix='/api/employees')
repo = EmployeeRepository()

@employees_bp.route('', methods=['GET'])
@token_required
def get_employees():
<<<<<<< HEAD
    """Get all employees, optionally filtered by site, name, or active status, scoped to tenant."""
=======
    """Get all employees in the current business, optionally filtered by site, name, or active status."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
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
<<<<<<< HEAD
        # For name search, we need special handling
        results = repo.search_by_name(name_query, site_id)
        # Filter by business_id and active status manually
        results = [e for e in results if e.business_id == g.current_user.business_id]
        if only_active:
            results = [e for e in results if e.is_active]
    else:
        results = repo.get_all(filters=filters)
=======
        results = repo.search_by_name(name_query, business_id=g.business_id, site_id=site_id)
        # Filter for active if requested
        if only_active:
            results = [e for e in results if e.is_active]
    elif site_id:
        if only_active:
            results = repo.get_active_by_site(site_id, business_id=g.business_id)
        else:
            results = repo.get_by_site(site_id, business_id=g.business_id)
    else:
        if only_active:
            results = repo.get_active_employees(business_id=g.business_id)
        else:
            results = repo.get_all_for_business(business_id=g.business_id)
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
            
    return api_response(data=models_to_list(results))

@employees_bp.route('', methods=['POST'])
@token_required
def create_employee():
<<<<<<< HEAD
    """Create a new employee, scoped to tenant."""
=======
    """Create a new employee in the current business."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
<<<<<<< HEAD
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
=======
        # Check passport uniqueness if provided (globally unique)
        if data.get('passport_id') and repo.get_by_passport(data['passport_id']):
             return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d

        # Inject business_id from context
        data['business_id'] = g.business_id
        
        employee = repo.create(**data)
        return api_response(data=model_to_dict(employee), message="Employee created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['GET'])
@token_required
def get_employee(employee_id):
<<<<<<< HEAD
    """Get a specific employee by ID, scoped to tenant."""
    employee = repo.get_by_id(employee_id)
    
    # Validate tenant scoping
    if not employee or employee.business_id != g.current_user.business_id:
=======
    """Get a specific employee by ID (must belong to current business)."""
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    return api_response(data=model_to_dict(employee))

@employees_bp.route('/<uuid:employee_id>', methods=['PUT'])
@token_required
def update_employee(employee_id):
<<<<<<< HEAD
    """Update an employee, scoped to tenant."""
=======
    """Update an employee (must belong to current business)."""
    # Verify ownership
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
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

        # Prevent changing business_id
        if 'business_id' in data:
            del data['business_id']

        updated_employee = repo.update(employee_id, **data)
            
        return api_response(data=model_to_dict(updated_employee), message="Employee updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['DELETE'])
@token_required
def delete_employee(employee_id):
<<<<<<< HEAD
    """Delete an employee (soft delete), scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
=======
    """Delete an employee (must belong to current business)."""
    # Verify ownership
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
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
<<<<<<< HEAD
    """Deactivate an employee, scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
=======
    """Deactivate an employee (must belong to current business)."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    try:
        success = repo.deactivate(employee_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/activate', methods=['POST'])
@token_required
def activate_employee(employee_id):
<<<<<<< HEAD
    """Activate an employee, scoped to tenant."""
    # Validate tenant scoping
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
=======
    """Activate an employee (must belong to current business)."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    try:
        success = repo.activate(employee_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate employee", error=str(e))
