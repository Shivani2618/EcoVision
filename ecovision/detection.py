"""
detection.py – EcoVision 2.0 AI Waste Detection Pipeline
Supports: YOLOv8 Trained Model (Primary) + Heuristic + Simulation fallback
"""

from __future__ import annotations

import random
import time
from typing import Optional, Tuple

import cv2
import numpy as np
import torch
import gc

# ---------------- MODEL LOADING ----------------
MODEL = None

# 10 classes matching the display names used in training (train.py CLASS_NAMES)
# NOTE: The trained model stores its own class index→name map internally.
#       We ALWAYS read class names from results[0].names at inference time
#       to avoid index-order mismatches caused by YOLOv8 alphabetic sorting.
CLASS_NAMES = [
    "Battery", "Biological", "Cardboard", "Clothes",
    "Glass", "Metal", "Paper", "Plastic",
    "Shoes", "Trash"
]

# Canonical display name normalisation:
# The model was trained with folders named "Organic" (biological waste).
# Map it back so the rest of the app sees "Biological".
_DISPLAY_NAME_MAP: dict[str, str] = {
    "Organic":    "Biological",
    "biological": "Biological",
    "organic":    "Biological",
    "battery":    "Battery",
    "cardboard":  "Cardboard",
    "clothes":    "Clothes",
    "glass":      "Glass",
    "metal":      "Metal",
    "paper":      "Paper",
    "plastic":    "Plastic",
    "shoes":      "Shoes",
    "trash":      "Trash",
}

# ---------------- CONSTANTS ----------------
WASTE_LABELS = CLASS_NAMES.copy()

try:
    from ultralytics import YOLO
    import os
    _DET_DIR = os.path.dirname(os.path.abspath(__file__))
    _MODEL_PATH = os.path.join(_DET_DIR, "model", "waste_classifier.pt")
    
    print(f"🧠 Attempting to load YOLOv8 model from: {_MODEL_PATH}")
    if not os.path.exists(_MODEL_PATH):
        print(f"❌ Model file NOT found at: {_MODEL_PATH}")
    
    MODEL = YOLO(_MODEL_PATH)
    print(f"✅ YOLOv8 Model Loaded Successfully.")
    
    # Print the model's own class names so we can verify alignment at startup
    if hasattr(MODEL, "names"):
        print(f"📊 Model classes detected: {MODEL.names}")
except ImportError:
    print("⚠️ ultralytics not installed — running in fallback mode (CV heuristics only).")
except Exception as e:
    print(f"❌ Model loading failed: {e}")
    print("⚠️ Falling back to CV heuristics and simulation.")

AUTHORITY_MAP = {
    "Biological": "Compost Department",
    "Cardboard": "Paper Recycling Unit",
    "Paper": "Paper Recycling Unit",
    "Plastic": "Recycling Unit",
    "Glass": "Glass Recycling Unit",
    "Metal": "Scrap Management",
    "Clothes": "Textile Recovery",
    "Shoes": "Textile Recovery",
    "Trash": "General Landfill Auth",
    "Battery": "Hazard Control Authority",
    "Overflow": "Emergency Cleaning Team",
}

WASTE_COLORS = {
    "Biological": (34, 197, 94),
    "Cardboard": (217, 119, 6),
    "Paper": (253, 230, 138),
    "Plastic": (59, 130, 246),
    "Glass": (6, 182, 212),
    "Metal": (156, 163, 175),
    "Clothes": (168, 85, 247),
    "Shoes": (236, 72, 153),
    "Trash": (107, 114, 128),
    "Battery": (239, 68, 68),
}

# ---------------- PREPROCESS (kept for heuristic path) ----------------
def preprocess(frame: np.ndarray) -> np.ndarray:
    img = cv2.resize(frame, (224, 224))
    img = img / 255.0
    return np.expand_dims(img, axis=0)


# ---------------- DISPLAY NAME NORMALISATION ----------------
def _normalise_class_name(raw: str) -> str:
    """
    Convert any class name variant returned by the model into the canonical
    display name used by the rest of the EcoVision application.
    """
    return _DISPLAY_NAME_MAP.get(raw, _DISPLAY_NAME_MAP.get(raw.lower(), raw))


# ---------------- YOLO CLASSIFIER ----------------
def _model_classify(frame: np.ndarray) -> Optional[Tuple[str, float]]:
    """
    Run YOLOv8 classification inference on a single BGR frame.

    IMPORTANT: We read the predicted class name directly from
    results[0].names[idx] — the model's own internal mapping —
    instead of indexing into our hardcoded CLASS_NAMES list.
    This is the only safe approach because YOLOv8 sorts class
    folder names alphabetically when building its internal index,
    which may differ from any hardcoded list we maintain.
    """
    if MODEL is None:
        return None
    try:
        # ultralytics expects RGB; results[0].probs gives classification probs
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        with torch.no_grad():
            results = MODEL.predict(source=rgb, verbose=False, imgsz=224, device='cpu')

        probs = results[0].probs
        if probs is None:
            return None

        idx = int(probs.top1)
        confidence = float(probs.top1conf) * 100.0

        # ── Use the model's own names dict — avoids index mismatch ──────────
        model_names: dict = results[0].names  # {0: 'Battery', 1: 'Cardboard', …}
        raw_name = model_names.get(idx, None)
        if raw_name is None:
            return None

        # Normalise to canonical display name (e.g. "Organic" → "Biological")
        final_class = _normalise_class_name(raw_name)

        print(f"[detection] Model → idx={idx}, raw='{raw_name}', "
              f"display='{final_class}', conf={confidence:.1f}%")

        return final_class, round(confidence, 1)

    except Exception as e:
        print(f"[detection] Model inference error: {e}")
        return None
    finally:
        # Force garbage collection to free memory on limited environments like Render
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


# ---------------- HEURISTIC FALLBACK ----------------
def _heuristic_classify(frame: np.ndarray) -> Tuple[str, float]:
    """
    Improved CV heuristic to prevent 'Paper' bias.
    Uses color, saturation, and edge density to differentiate waste types.
    """
    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Color Masks
    green_mask  = cv2.inRange(hsv, (35, 40, 40), (85, 255, 255))
    blue_mask   = cv2.inRange(hsv, (90, 50, 50), (130, 255, 255))
    red_mask1   = cv2.inRange(hsv, (0, 70, 50), (10, 255, 255))
    red_mask2   = cv2.inRange(hsv, (170, 70, 50), (180, 255, 255))
    
    green_ratio = float(np.mean(green_mask > 0))
    blue_ratio  = float(np.mean(blue_mask > 0))
    red_ratio   = float(np.mean(red_mask1 > 0) + np.mean(red_mask2 > 0))

    sat   = float(np.mean(hsv[:, :, 1]) / 255.0)
    val   = float(np.mean(hsv[:, :, 2]) / 255.0)
    edges = float(np.mean(cv2.Canny(gray, 60, 160) > 0))

    # Scoring logic with better balance
    scores = {
        "Biological": green_ratio * 2.5 + (0.3 if 0.2 < val < 0.6 else 0),
        "Plastic":    blue_ratio * 2.0 + sat * 0.5,
        "Metal":      edges * 1.5 + (0.4 if 0.4 < val < 0.8 and sat < 0.2 else 0),
        "Glass":      edges * 1.0 + (0.5 if val > 0.8 and sat < 0.15 else 0),
        "Cardboard":  (0.6 if 0.1 < sat < 0.4 and 0.3 < val < 0.7 else 0) + edges * 0.3,
        "Paper":      (0.8 if val > 0.85 and sat < 0.1 else 0),
        "Clothes":    sat * 0.7 + red_ratio * 1.5,
        "Shoes":      edges * 0.9 + sat * 0.3,
        "Battery":    red_ratio * 1.2 + edges * 0.4,
        "Trash":      0.2, # Baseline
    }

    # Add a small amount of random jitter for demo diversity
    for k in scores:
        scores[k] += random.uniform(0, 0.15)

    best = max(scores, key=lambda k: scores[k])
    conf = round(random.uniform(62.0, 88.0), 1)
    return best, conf


# ---------------- SIMULATION ----------------
def simulate_detection() -> dict:
    label = random.choice(WASTE_LABELS)
    conf  = round(random.uniform(70.0, 95.0), 1)
    return _build_result(label, conf)


# ---------------- MAIN PIPELINE ----------------
def classify_frame(frame: np.ndarray) -> dict:
    """
    Priority order:
      1. YOLOv8 model  (if loaded)
      2. CV heuristic  (if frame is valid)
      3. Simulation    (last resort)
    """
    if frame is None or frame.size == 0:
        return simulate_detection()

    # 1️⃣ Try YOLO model
    result = _model_classify(frame)
    if result is not None:
        return _build_result(*result)

    # 2️⃣ Heuristic fallback
    try:
        label, conf = _heuristic_classify(frame)
        return _build_result(label, conf)
    except Exception:
        pass

    # 3️⃣ Pure simulation
    return simulate_detection()


# ---------------- RESULT BUILDER ----------------
def _build_result(label: str, conf: float) -> dict:
    return {
        "waste_type": label,
        "confidence": conf,
        "authority":  AUTHORITY_MAP.get(label, "General Waste Authority"),
        "color":      WASTE_COLORS.get(label, (255, 255, 255)),
        "timestamp":  time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


# ---------------- OVERLAY ----------------
def draw_overlay(frame: np.ndarray, result: dict, fill_level: float) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]

    # color stored as RGB tuple → convert to BGR for OpenCV
    color_rgb = result.get("color", (255, 255, 255))
    color_bgr = tuple(reversed(color_rgb))

    cv2.rectangle(out, (10, 10), (380, 115), color_bgr, 2)

    cv2.putText(out, f"Waste: {result['waste_type']}", (24, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.putText(out, f"Conf:  {result['confidence']}%", (24, 70),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 255, 200), 2)
    cv2.putText(out, f"Fill:  {fill_level:.1f}%", (24, 100),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_bgr, 2)

    return out
