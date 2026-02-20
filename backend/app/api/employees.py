import uuid
import logging
import traceback
from flask import Blueprint, request, g
from ..repositories.employee_repository import EmployeeRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required, role_required

logger = logging.getLogger(__name__)

employees_bp = Blueprint('employees', __name__, url_prefix='/api/employees')
repo = EmployeeRepository()

EMPLOYEE_STATUS_VALUES = {
    'ACTIVE',
    'REPORTED_IN_SPARK',
    'REPORTED_RETURNED_FROM_ESCAPE'
}

@employees_bp.route('', methods=['GET'])
@token_required
def get_employees():
    """Get all employees in the current business, optionally filtered by site, name, or active status."""
    try:
        site_id = request.args.get('site_id')
        name_query = request.args.get('name')
        only_active = request.args.get('active', 'false').lower() == 'true'
        
        # Convert site_id to UUID if present
        site_id_uuid = None
        if site_id:
            try:
                site_id_uuid = uuid.UUID(site_id)
            except ValueError:
                return api_response(status_code=400, message="Invalid site_id format", error="Bad Request")
        
        if name_query:
            results = repo.search_by_name(name_query, business_id=g.business_id, site_id=site_id_uuid)
            # Filter for active if requested
            if only_active:
                results = [e for e in results if e.is_active]
        else:
            if site_id_uuid:
                if only_active:
                    results = repo.get_active_by_site(site_id_uuid, business_id=g.business_id)
                else:
                    results = repo.get_by_site(site_id_uuid, business_id=g.business_id)
            else:
                if only_active:
                    results = repo.get_active_employees(business_id=g.business_id)
                else:
                    results = repo.get_all_for_business(business_id=g.business_id)
                
        return api_response(data=models_to_list(results))
    except Exception as e:
        logger.exception("Failed to get employees")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get employees", error=str(e))

@employees_bp.route('', methods=['POST'])
@token_required
@role_required('ADMIN')
def create_employee():
    """Create a new employee in the current business."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Validation
        if not data.get('full_name'):
            return api_response(status_code=400, message="Full name is required", error="Bad Request")
        if not data.get('passport_id'):
            return api_response(status_code=400, message="Passport ID is required", error="Bad Request")
        # phone_number is optional
        # site_id is optional

        # Check passport uniqueness (scoped to business)
        if repo.get_by_passport(data['passport_id'], business_id=g.business_id):
            return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        if data.get('status') and data['status'] not in EMPLOYEE_STATUS_VALUES:
            return api_response(status_code=400, message="Invalid status value", error="Bad Request")

        # Inject business_id from context
        data['business_id'] = g.business_id
        
        employee = repo.create(**data)
        return api_response(data=model_to_dict(employee), message="Employee created successfully", status_code=201)
    except Exception as e:
        logger.exception("Failed to create employee")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to create employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['GET'])
@token_required
def get_employee(employee_id):
    """Get a specific employee by ID (must belong to current business)."""
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    return api_response(data=model_to_dict(employee))

@employees_bp.route('/<uuid:employee_id>', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_employee(employee_id):
    """Update an employee (must belong to current business)."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    
    # Verify ownership
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
        
    try:
        # Prevent changing business_id
        data.pop('business_id', None)
        data.pop('id', None)
        
        # Check passport uniqueness (scoped to business) if changed
        if data.get('passport_id'):
            existing = repo.get_by_passport(data['passport_id'], business_id=g.business_id)
            if existing and str(existing.id) != str(employee_id):
                return api_response(status_code=409, message="Employee with this passport ID already exists", error="Conflict")

        if data.get('status') and data['status'] not in EMPLOYEE_STATUS_VALUES:
            return api_response(status_code=400, message="Invalid status value", error="Bad Request")

        updated_employee = repo.update(employee_id, **data)
            
        return api_response(data=model_to_dict(updated_employee), message="Employee updated successfully")
    except Exception as e:
        logger.exception(f"Failed to update employee {employee_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to update employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>', methods=['DELETE'])
@token_required
@role_required('ADMIN')
def delete_employee(employee_id):
    """Delete an employee (must belong to current business)."""
    # Verify ownership
    employee = repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    
    try:
        success = repo.deactivate(employee_id, business_id=g.business_id)  # Soft delete via deactivation
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deleted successfully")
    except Exception as e:
        logger.exception(f"Failed to delete employee {employee_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to delete employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/deactivate', methods=['POST'])
@token_required
@role_required('ADMIN')
def deactivate_employee(employee_id):
    """Deactivate an employee (must belong to current business)."""
    try:
        success = repo.deactivate(employee_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee deactivated successfully")
    except Exception as e:
        logger.exception(f"Failed to deactivate employee {employee_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to deactivate employee", error=str(e))

@employees_bp.route('/<uuid:employee_id>/activate', methods=['POST'])
@token_required
@role_required('ADMIN')
def activate_employee(employee_id):
    """Activate an employee (must belong to current business)."""
    try:
        success = repo.activate(employee_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="Employee not found", error="Not Found")
            
        return api_response(message="Employee activated successfully")
    except Exception as e:
        logger.exception(f"Failed to activate employee {employee_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to activate employee", error=str(e))
