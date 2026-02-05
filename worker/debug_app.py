"""
Debug extraction server — upload an image and visualize crops + extracted data.

Usage:
    python worker/debug_app.py
"""
import base64
from io import BytesIO
from typing import List

import cv2
from flask import Flask, render_template, request, jsonify

from extractor import (
    crop_tables_from_image_bytes,
    extract_from_image_bytes,
    PIPELINE_VERSION,
)

app = Flask(__name__)


def encode_image_array(image_array) -> str:
    """Convert OpenCV image to base64 data URL."""
    _, buffer = cv2.imencode(".jpg", image_array)
    return base64.b64encode(buffer).decode("utf-8")


@app.route("/debug")
def debug_view():
    return render_template("extraction-debug.html")


@app.route("/process", methods=["POST"])
def process_image():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    file_bytes = file.read()

    if not file_bytes:
        return jsonify({"error": "Empty file"}), 400

    try:
        crops = crop_tables_from_image_bytes(file_bytes)
        crop_display_data: List[str] = []
        for crop in crops:
            b64_str = encode_image_array(crop)
            crop_display_data.append(f"data:image/jpeg;base64,{b64_str}")

        extraction_result = extract_from_image_bytes(file_bytes) or {}

        return jsonify({
            "crops": crop_display_data,
            "data": extraction_result.get("entries", []),
            "extracted_employee_name": extraction_result.get("extracted_employee_name"),
            "extracted_passport_id": extraction_result.get("extracted_passport_id"),
            "raw_result": extraction_result.get("raw_result"),
            "model_name": extraction_result.get("model_name"),
            "pipeline_version": PIPELINE_VERSION,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001)
