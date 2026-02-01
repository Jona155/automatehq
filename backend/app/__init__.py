import os
from flask import Flask, request, send_from_directory
from flask_migrate import Migrate
from .extensions import db
from . import models  # Register models
from .api import register_blueprints

def create_app():
    # Configure static file serving for production (React build)
    static_folder = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'dist')
    app = Flask(
        __name__,
        static_folder=static_folder if os.path.exists(static_folder) else None,
        template_folder=static_folder if os.path.exists(static_folder) else None
    )
    
    # Config
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    
    # Fix DATABASE_URL protocol for Heroku compatibility
    # Heroku provides postgres:// but SQLAlchemy 1.4+ requires postgresql://
    database_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/automatehq")
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    
    # Initialize extensions
    db.init_app(app)
    Migrate(app, db)
    
    # Register Blueprints
    register_blueprints(app)
    
    # CORS configuration - manual after_request handler for reliability
    allowed_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]
    
    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept, Origin, X-Requested-With"
            response.headers["Access-Control-Max-Age"] = "3600"
            response.headers["Access-Control-Expose-Headers"] = "Content-Type, Authorization"
        return response
    
    @app.get("/api/health")
    def health():
        return {"ok": True}
    
    # Catch-all route for React Router (serves index.html for non-API routes)
    # This MUST be registered AFTER all API blueprints
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_react_app(path):
        # Only serve static files for non-API routes
        if path.startswith('api/'):
            # This should never be reached due to API blueprints, but just in case
            return {"error": "Not found"}, 404
        
        # Check if static folder exists (production)
        if app.static_folder and os.path.exists(app.static_folder):
            # Try to serve the requested file
            file_path = os.path.join(app.static_folder, path)
            if os.path.isfile(file_path):
                return send_from_directory(app.static_folder, path)
            # Otherwise serve index.html for client-side routing
            return send_from_directory(app.static_folder, 'index.html')
        
        # Development mode - no static folder
        return {"message": "Development mode - run frontend separately"}, 200
        
    return app
