import os
from flask import Flask
from flask_cors import CORS
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
    
    CORS(app, origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","))

    # Initialize extensions
    db.init_app(app)
    Migrate(app, db)
    
    # Register Blueprints
    register_blueprints(app)
    
    @app.get("/api/health")
    def health():
        return {"ok": True}
        
    return app
