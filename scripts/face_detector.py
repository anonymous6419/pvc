#!/usr/bin/env python3
"""
Face Detection using OpenCV Haar Cascades
Detects the largest face, adds padding, and saves cropped image
"""

import cv2
import sys
import json
import os


def detect_face(image_path, output_path):
    try:
        print("[INFO] Starting face detection")

        if not os.path.exists(image_path):
            return {"success": False, "error": "Input image not found"}

        print(f"[INFO] Loading image: {image_path}")
        image = cv2.imread(image_path)

        if image is None:
            return {"success": False, "error": "Failed to read image"}

        height, width = image.shape[:2]
        print(f"[INFO] Image size: {width}x{height}")

        print("[INFO] Loading Haar Cascade model")
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        print("[INFO] Detecting faces")
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30)
        )

        if len(faces) == 0:
            return {"success": False, "error": "No face detected"}

        print(f"[INFO] Faces detected: {len(faces)}")

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        print(f"[INFO] Largest face at x={x}, y={y}, w={w}, h={h}")

        padding_x = int(w * 0.45)
        padding_top = int(h * 0.25)
        padding_bottom = int(h * 0.90)

        x1 = max(0, x - padding_x)
        y1 = max(0, y - padding_top)
        x2 = min(width, x + w + padding_x)
        y2 = min(height, y + h + padding_bottom)

        print("[INFO] Cropping face region")
        cropped_face = image[y1:y2, x1:x2]

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        cv2.imwrite(output_path, cropped_face)

        print(f"[INFO] Cropped face saved to: {output_path}")

        return {
            "success": True,
            "path": output_path,
            "bbox": {
                "x": int(x1),
                "y": int(y1),
                "width": int(x2 - x1),
                "height": int(y2 - y1)
            },
            "padding": {
                "horizontal": int(padding_x),
                "top": int(padding_top),
                "bottom": int(padding_bottom)
            }
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({
            "success": False,
            "error": "Usage: python face_detector.py <input_image> <output_image>"
        }))
        sys.exit(1)

    result = detect_face(sys.argv[1], sys.argv[2])
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["success"] else 1)
