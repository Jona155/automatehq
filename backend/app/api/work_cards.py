from flask import Blueprint, request, g
from datetime import datetime
from ..repositories.work_card_repository import WorkCardRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

work_cards_bp = Blueprint('work_cards', __name__, url_prefix='/api/work_cards')
repo = WorkCardRepository()

@work_cards_bp.route('', methods=['GET'])
@token_required
def get_work_cards():
    """Get work cards in the current business, filtered by site+month or status."""
    site_id = request.args.get('site_id')
    month_str = request.args.get('month') # YYYY-MM-DD
    status = request.args.get('status')
    
    if site_id and month_str:
        try:
            month = datetime.strptime(month_str, '%Y-%m-%d').date()
            results = repo.get_by_site_month(site_id, month, business_id=g.business_id)
        except ValueError:
            return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")
    elif status:
        results = repo.get_by_review_status(status, business_id=g.business_id)
    else:
        results = repo.get_all_for_business(business_id=g.business_id)
        
    return api_response(data=models_to_list(results))

@work_cards_bp.route('/<uuid:card_id>', methods=['GET'])
@token_required
def get_work_card(card_id):
    """Get a specific work card (must belong to current business), optionally with details."""
    include_details = request.args.get('details', 'false').lower() == 'true'
    
    if include_details:
        card = repo.get_with_all_relations(card_id)
    else:
        card = repo.get_by_id(card_id)
    
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = model_to_dict(card)
    
    # Handle relationships if loaded
    if include_details:
        if card.extraction:
            data['extraction'] = model_to_dict(card.extraction)
        if card.day_entries:
            data['day_entries'] = models_to_list(card.day_entries)
        if card.files:
            data['files'] = models_to_list(card.files)
            
    return api_response(data=data)

@work_cards_bp.route('/<uuid:card_id>', methods=['PUT'])
@token_required
def update_work_card(card_id):
    """Update a work card (must belong to current business, e.g. assign employee)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    
    # Prevent changing business_id
    if 'business_id' in data:
        del data['business_id']
        
    try:
        updated_card = repo.update(card_id, **data)
        if not updated_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_card), message="Work card updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/status', methods=['PUT'])
@token_required
def update_status(card_id):
    """Update review status (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    status = data.get('status')
    
    if not status:
         return api_response(status_code=400, message="Status is required", error="Bad Request")
         
    try:
        updated_card = repo.update_review_status(card_id, status)
        if not updated_card:
             return api_response(status_code=404, message="Work card not found", error="Not Found")
             
        return api_response(data=model_to_dict(updated_card), message="Status updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update status", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/approve', methods=['POST'])
@token_required
def approve_work_card(card_id):
    """Approve a work card (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    user_id = data.get('user_id')
    
    if not user_id:
        return api_response(status_code=400, message="User ID is required for approval", error="Bad Request")
        
    try:
        approved_card = repo.approve_card(card_id, user_id)
        if not approved_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")
            
        return api_response(data=model_to_dict(approved_card), message="Work card approved successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to approve work card", error=str(e))
