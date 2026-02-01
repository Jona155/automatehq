import os
from flask import Flask, request
from flask_migrate import Migrate
from .extensions import db
from . import models  # Register models
from .api import register_blueprints

def create_app():
    app = Flask(__name__)
    
    # Config
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/automatehq")
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
        
    return app
