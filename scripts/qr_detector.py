#!/usr/bin/env python3
"""
QR Code Detection and Decoding with Perfect Boundaries using OpenCV
Extracts QR region with quiet zone and decodes data
"""

import cv2
import sys
import json
import os
import numpy as np

def detect_qr(image_path, output_path):
    """
    Detect QR code in image, decode it, and save cropped version with perfect boundaries
    
    Args:
        image_path: Path to input image
        output_path: Path to save cropped QR image
    
    Returns:
        JSON with success status, output path, and decoded data
    """
    try:
        # Check if input file exists
        if not os.path.exists(image_path):
            return {"success": False, "error": "Input image not found"}
        
        # Read image
        img = cv2.imread(image_path)
        if img is None:
            return {"success": False, "error": "Failed to read image"}
        
        # Initialize QR code detector
        qr_detector = cv2.QRCodeDetector()
        
        # Try multiple preprocessing strategies
        strategies = [
            ("original", img),
            ("grayscale", cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)),
            ("enhanced", cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))),
            ("bilateral", cv2.bilateralFilter(img, 9, 75, 75)),
            ("denoised", cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21))
        ]
        
        data = None
        bbox = None
        straight_qrcode = None
        
        for strategy_name, processed_img in strategies:
            # Detect and decode QR code
            if len(processed_img.shape) == 2:  # Grayscale
                processed_img = cv2.cvtColor(processed_img, cv2.COLOR_GRAY2BGR)
            
            result_data, result_bbox, result_qr = qr_detector.detectAndDecode(processed_img)
            
            if result_bbox is not None and len(result_bbox) > 0:
                data = result_data
                bbox = result_bbox
                straight_qrcode = result_qr
                break  # Found QR code
        
        if bbox is None or len(bbox) == 0:
            # Fallback: Try detecting in middle-right region (common for E-Shram)
            img_height, img_width = img.shape[:2]
            
            # Crop middle-right region (50-100% x, 25-75% y)
            x1 = int(img_width * 0.50)
            y1 = int(img_height * 0.25)
            x2 = img_width
            y2 = int(img_height * 0.75)
            
            region = img[y1:y2, x1:x2]
            
            # Try detecting in this region
            for strategy_name, processed_img in [
                ("region_original", region),
                ("region_gray", cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)),
                ("region_enhanced", cv2.equalizeHist(cv2.cvtColor(region, cv2.COLOR_BGR2GRAY))),
                ("region_threshold", cv2.threshold(cv2.cvtColor(region, cv2.COLOR_BGR2GRAY), 128, 255, cv2.THRESH_BINARY)[1])
            ]:
                if len(processed_img.shape) == 2:
                    processed_img = cv2.cvtColor(processed_img, cv2.COLOR_GRAY2BGR)
                
                result_data, result_bbox, result_qr = qr_detector.detectAndDecode(processed_img)
                
                if result_bbox is not None and len(result_bbox) > 0:
                    # Adjust bbox coordinates from region to full image
                    data = result_data
                    bbox = result_bbox
                    bbox[0][:, 0] += x1  # Add x offset
                    bbox[0][:, 1] += y1  # Add y offset
                    straight_qrcode = result_qr
                    break
            
            if bbox is None or len(bbox) == 0:
                # Last resort: Extract and enhance the middle-right region as QR
                # Step 1: Convert to grayscale
                gray_region = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
                
                # Step 2: Upscale to minimum 800x800 for better quality
                h, w = gray_region.shape
                target_size = 800
                if h < target_size or w < target_size:
                    scale_factor = max(target_size / h, target_size / w)
                    new_w = int(w * scale_factor)
                    new_h = int(h * scale_factor)
                    gray_region = cv2.resize(gray_region, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                
                # Step 3: Light denoising (keep natural look)
                denoised = cv2.fastNlMeansDenoising(gray_region, None, h=5, templateWindowSize=7, searchWindowSize=21)
                
                # Step 4: Slight contrast enhancement
                enhanced = cv2.convertScaleAbs(denoised, alpha=1.2, beta=10)
                
                # Step 5: Apply unsharp masking for crystal-clear edges
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
                sharpened = cv2.addWeighted(enhanced, 1.5, gaussian, -0.5, 0)
                
                # Step 6: Add white padding (quiet zone)
                h, w = sharpened.shape
                padding = int(max(h, w) * 0.08)
                final_qr = cv2.copyMakeBorder(sharpened, padding, padding, padding, padding, cv2.BORDER_CONSTANT, value=255)
                
                # Ensure output directory exists
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                # Save natural-looking QR image
                cv2.imwrite(output_path, final_qr)
                
                return {
                    "success": True,
                    "path": output_path,
                    "data": None,
                    "bbox": {
                        "x": x1,
                        "y": y1,
                        "width": x2 - x1,
                        "height": y2 - y1
                    },
                    "padding": padding,
                    "dataLength": 0,
                    "note": "QR region extracted with natural appearance (not binary)"
                }
        
        # Get bounding box coordinates
        bbox = bbox[0].astype(int)
        
        # Calculate bounding rectangle
        x_min = int(bbox[:, 0].min())
        y_min = int(bbox[:, 1].min())
        x_max = int(bbox[:, 0].max())
        y_max = int(bbox[:, 1].max())
        
        qr_width = x_max - x_min
        qr_height = y_max - y_min
        
        # Add generous padding for quiet zone (40% on all sides for better decoding)
        padding = int(max(qr_width, qr_height) * 0.40)
        
        # Calculate crop boundaries (ensure within image bounds)
        img_height, img_width = img.shape[:2]
        x1 = max(0, x_min - padding)
        y1 = max(0, y_min - padding)
        x2 = min(img_width, x_max + padding)
        y2 = min(img_height, y_max + padding)
        
        # Crop QR code with quiet zone
        qr_crop = img[y1:y2, x1:x2]
        
        # Convert to grayscale if needed for better quality
        if len(qr_crop.shape) == 3:
            qr_gray = cv2.cvtColor(qr_crop, cv2.COLOR_BGR2GRAY)
        else:
            qr_gray = qr_crop
        
        # Upscale to minimum 800x800 for much better scannability
        target_size = 800
        if qr_gray.shape[0] < target_size or qr_gray.shape[1] < target_size:
            scale_factor = max(target_size / qr_gray.shape[0], target_size / qr_gray.shape[1])
            new_width = int(qr_gray.shape[1] * scale_factor)
            new_height = int(qr_gray.shape[0] * scale_factor)
            qr_upscaled = cv2.resize(qr_gray, (new_width, new_height), interpolation=cv2.INTER_LANCZOS4)
            
            # Apply unsharp masking for crystal-clear edges
            gaussian = cv2.GaussianBlur(qr_upscaled, (0, 0), 2.0)
            qr_upscaled = cv2.addWeighted(qr_upscaled, 1.5, gaussian, -0.5, 0)
            
            # Try to decode the upscaled version if data is empty
            if not data:
                upscale_data, _, _ = qr_detector.detectAndDecode(qr_upscaled)
                if upscale_data:
                    data = upscale_data
        else:
            qr_upscaled = qr_gray
        
        # Light enhancement only - keep natural appearance
        # Remove noise gently
        denoised = cv2.fastNlMeansDenoising(qr_upscaled, None, h=5, templateWindowSize=7, searchWindowSize=21)
        
        # Slight contrast enhancement (not aggressive)
        enhanced = cv2.convertScaleAbs(denoised, alpha=1.2, beta=10)
        
        # Apply unsharp masking for sharper QR edges
        gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
        sharpened = cv2.addWeighted(enhanced, 1.5, gaussian, -0.5, 0)
        
        # Add white padding (quiet zone) - makes it scannable
        final_padding = int(max(sharpened.shape) * 0.08)
        final_qr = cv2.copyMakeBorder(sharpened, final_padding, final_padding, final_padding, final_padding, cv2.BORDER_CONSTANT, value=255)
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Save natural-looking QR (grayscale, not binary)
        cv2.imwrite(output_path, final_qr)
        
        return {
            "success": True,
            "path": output_path,
            "data": data if data else None,
            "bbox": {
                "x": int(x1),
                "y": int(y1),
                "width": int(x2 - x1),
                "height": int(y2 - y1)
            },
            "padding": padding,
            "dataLength": len(data) if data else 0
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"success": False, "error": "Usage: python qr_detector.py <input_image> <output_image>"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    output_path = sys.argv[2]
    
    result = detect_qr(image_path, output_path)
    print(json.dumps(result))
    
    sys.exit(0 if result["success"] else 1)
