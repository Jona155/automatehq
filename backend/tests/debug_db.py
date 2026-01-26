import os
from backend.app import create_app, db
from sqlalchemy import text

app = create_app()

with app.app_context():
    print(f"DB URI: {app.config['SQLALCHEMY_DATABASE_URI']}")
    try:
        db.session.execute(text("SELECT 1"))
        print("DB Connection Successful")
    except Exception as e:
        print(f"DB Connection Failed: {e}")
