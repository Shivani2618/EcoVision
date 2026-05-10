from ultralytics import YOLO
import sys

MODEL_PATH = "model/waste_classifier.pt"
model = YOLO(MODEL_PATH)

print("Model class order:", model.names)

if len(sys.argv) > 1:
    IMAGE_PATH = sys.argv[1]
    results = model.predict(source=IMAGE_PATH, imgsz=224, verbose=False)
    probs = results[0].probs

    print("\n===== EcoVision Model Test =====")
    print(f"Image      : {IMAGE_PATH}")
    print(f"Top-1 class: {model.names[probs.top1]}  ({probs.top1conf*100:.1f}%)")
    print("\nTop-5 predictions:")
    for idx, conf in zip(probs.top5, probs.top5conf):
        print(f"  {model.names[idx]:<12} {conf*100:.1f}%")
    print("================================\n")