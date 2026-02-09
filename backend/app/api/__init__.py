from flask import Flask
from .businesses import businesses_bp
from .sites import sites_bp
from .employees import employees_bp
from .users import users_bp
from .work_cards import work_cards_bp
from .auth import auth_bp
from .public_portal import public_portal_bp
from .dashboard import dashboard_bp
from .employee_imports import employee_imports_bp

def register_blueprints(app: Flask):
    """Register all API blueprints."""
    app.register_blueprint(businesses_bp)
    app.register_blueprint(sites_bp)
    app.register_blueprint(employees_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(work_cards_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(public_portal_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(employee_imports_bp)
