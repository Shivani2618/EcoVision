"""
ECOVISION — Waste Classifier Training (YOLOv8 — FINAL VERSION)
==============================================================

✔ Uses LOCAL dataset (garbage-classification-v2 layout)
  → https://www.kaggle.com/datasets/sumn2u/garbage-classification-v2
✔ Supports 10 classes
✔ Automatic train/val/test split (70 / 15 / 15)
✔ YOLOv8 nano/small classification — fast & accurate
✔ Exports best weights to  model/waste_classifier.pt

Dataset expected layout (one sub-folder per class):
    model/dataset/
        battery/
        biological/
        cardboard/
        clothes/
        glass/
        metal/
        paper/
        plastic/
        shoes/
        trash/

Run:
    python model/train.py
    # or from project root:
    python -m model.train
"""

import json
import os
import random
import shutil
from pathlib import Path

# ─────────────────────────── CONFIG ───────────────────────────────────────────
SEED         = 42
IMG_SIZE     = 224          # pixels (YOLOv8 classifier uses square crops)
BATCH_SIZE   = 32
EPOCHS       = 30           # YOLO handles early-stopping internally via patience
YOLO_MODEL   = "yolov8n-cls.pt"   # nano classification backbone — swap to
                                   # "yolov8s-cls.pt" for a small boost in acc
PATIENCE     = 7            # early-stop patience (epochs without improvement)

BASE_DIR        = Path(__file__).resolve().parent
RAW_DATASET_DIR = BASE_DIR / "dataset"          # ← change if your folder differs
SPLIT_DIR       = BASE_DIR / "dataset_split"
MODEL_OUTPUT    = BASE_DIR / "waste_classifier.pt"
META_PATH       = BASE_DIR / "model_meta.json"

# ─────────────────────────── CLASSES ──────────────────────────────────────────
# Folder names  (lowercase, exactly as in kaggle dataset)
CLASS_ORDER = [
    "battery", "biological", "cardboard", "clothes",
    "glass", "metal", "paper", "plastic", "shoes", "trash",
]

# Display names  (capitalised; must match detection.py CLASS_NAMES order)
CLASS_NAMES = [
    "Battery", "Organic", "Cardboard", "Clothes",
    "Glass", "Metal", "Paper", "Plastic", "Shoes", "Trash",
]

CLASS_MAP = dict(zip(CLASS_ORDER, CLASS_NAMES))   # folder → display name


# ─────────────────────────── SEED ─────────────────────────────────────────────
def set_seed() -> None:
    random.seed(SEED)
    try:
        import numpy as np
        np.random.seed(SEED)
    except ImportError:
        pass


# ─────────────────────────── DATASET CHECK ────────────────────────────────────
def check_dataset() -> None:
    if not RAW_DATASET_DIR.exists():
        raise FileNotFoundError(
            f"❌ Dataset not found at {RAW_DATASET_DIR}\n"
            "   Download from https://www.kaggle.com/datasets/sumn2u/garbage-classification-v2 "
            "and place it at model/dataset/"
        )
    missing = [c for c in CLASS_ORDER if not (RAW_DATASET_DIR / c).exists()]
    if missing:
        raise FileNotFoundError(f"❌ Missing class folder(s): {missing}")
    print("✅ Dataset verified")


# ─────────────────────────── SPLIT ────────────────────────────────────────────
def build_split() -> None:
    """
    Rebuild train/val/test split from scratch every run so ratios are always
    fresh.  Uses 70 / 15 / 15 stratified split.
    """
    if SPLIT_DIR.exists():
        shutil.rmtree(SPLIT_DIR)

    for split in ("train", "val", "test"):
        for cls in CLASS_NAMES:
            (SPLIT_DIR / split / cls).mkdir(parents=True, exist_ok=True)

    total_files = 0
    for raw_cls, display_cls in CLASS_MAP.items():
        src_dir = RAW_DATASET_DIR / raw_cls
        # Accept common image extensions
        files = [
            f for f in src_dir.iterdir()
            if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        ]
        random.shuffle(files)

        n = len(files)
        train_end = int(0.70 * n)
        val_end   = int(0.85 * n)

        for split, chunk in (
            ("train", files[:train_end]),
            ("val",   files[train_end:val_end]),
            ("test",  files[val_end:]),
        ):
            for f in chunk:
                shutil.copy(f, SPLIT_DIR / split / display_cls / f.name)
        total_files += n
        print(f"  {display_cls:12s}: {n} images  "
              f"({train_end} train / {val_end - train_end} val / {n - val_end} test)")

    print(f"✅ Dataset split created  (total {total_files} images)")


# ─────────────────────────── TRAIN ────────────────────────────────────────────
def train() -> dict:
    """
    Train YOLOv8 classification model.
    Returns final metrics dict  {'top1': float, 'top5': float}.
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        raise ImportError(
            "ultralytics is not installed.\n"
            "Run:  pip install ultralytics"
        )

    model = YOLO(YOLO_MODEL)   # downloads pretrained weights on first run

    print(f"\n🚀 Training {YOLO_MODEL} for up to {EPOCHS} epochs "
          f"(patience={PATIENCE}, img={IMG_SIZE}, batch={BATCH_SIZE}) …")

    results = model.train(
        data      = str(SPLIT_DIR),     # folder with train/val sub-dirs
        task      = "classify",
        epochs    = EPOCHS,
        imgsz     = IMG_SIZE,
        batch     = BATCH_SIZE,
        patience  = PATIENCE,
        seed      = SEED,
        pretrained= True,
        exist_ok  = True,
        verbose   = True,
    )

    # ── Copy best weights to canonical path ──────────────────────────────────
    # ultralytics saves to runs/classify/train*/weights/best.pt
    run_dir   = Path(results.save_dir)
    best_pt   = run_dir / "weights" / "best.pt"
    if best_pt.exists():
        shutil.copy(best_pt, MODEL_OUTPUT)
        print(f"📦 Best weights copied → {MODEL_OUTPUT}")
    else:
        print(f"⚠️  best.pt not found at {best_pt}; check runs/ directory")

    # ── Extract final metrics ─────────────────────────────────────────────────
    metrics = {}
    try:
        # results.results_dict contains keys like metrics/accuracy_top1
        rd = results.results_dict
        metrics["top1"] = round(float(rd.get("metrics/accuracy_top1", 0.0)) * 100, 2)
        metrics["top5"] = round(float(rd.get("metrics/accuracy_top5", 0.0)) * 100, 2)
        print(f"🎯 Top-1 Accuracy: {metrics['top1']}%")
        print(f"🎯 Top-5 Accuracy: {metrics['top5']}%")
    except Exception as e:
        print(f"⚠️  Could not extract metrics: {e}")
        metrics = {"top1": 0.0, "top5": 0.0}

    return metrics


# ─────────────────────────── EVALUATE ─────────────────────────────────────────
def evaluate_on_test() -> dict:
    """
    Run the saved best model on the held-out test split and report accuracy.
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        print("⚠️  ultralytics not installed, skipping test evaluation")
        return {}

    if not MODEL_OUTPUT.exists():
        print("⚠️  No saved model found for evaluation")
        return {}

    model   = YOLO(str(MODEL_OUTPUT))
    metrics = model.val(
        data    = str(SPLIT_DIR),
        split   = "test",
        imgsz   = IMG_SIZE,
        batch   = BATCH_SIZE,
        verbose = False,
    )
    rd    = metrics.results_dict
    top1  = round(float(rd.get("metrics/accuracy_top1", 0.0)) * 100, 2)
    top5  = round(float(rd.get("metrics/accuracy_top5", 0.0)) * 100, 2)
    print(f"🧪 Test  Top-1: {top1}%   Top-5: {top5}%")
    return {"test_top1": top1, "test_top5": top5}


# ─────────────────────────── SAVE META ────────────────────────────────────────
def save_meta(train_metrics: dict, test_metrics: dict) -> None:
    meta = {
        "model":       YOLO_MODEL,
        "framework":   "ultralytics YOLOv8",
        "task":        "classify",
        "classes":     CLASS_NAMES,
        "image_size":  IMG_SIZE,
        "dataset":     "garbage-classification-v2 (local)",
        "split":       {"train": "70%", "val": "15%", "test": "15%"},
        "train_metrics": train_metrics,
        "test_metrics":  test_metrics,
    }
    META_PATH.write_text(json.dumps(meta, indent=2))
    print(f"📁 Metadata saved → {META_PATH}")


# ─────────────────────────── MAIN ─────────────────────────────────────────────
def main() -> None:
    set_seed()
    check_dataset()
    build_split()

    train_metrics = train()
    test_metrics  = evaluate_on_test()

    save_meta(train_metrics, test_metrics)

    print("\n" + "=" * 55)
    print("  ✅  TRAINING COMPLETE")
    print(f"  📦  Model : {MODEL_OUTPUT}")
    print(f"  📊  Top-1 : {train_metrics.get('top1', '?')}%")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    main()
