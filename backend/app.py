"""
AutomateHQ Flask API — admin-only.
"""
import os
from flask import Flask
from flask_cors import CORS

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
CORS(app, origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","))


@app.get("/api/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
