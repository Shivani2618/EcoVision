import cv2
import os

video_path = r'ecovision\static\demo_video.mp4'
if not os.path.exists(video_path):
    print(f"File not found: {video_path}")
else:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Failed to open video")
    else:
        ok, frame = cap.read()
        if ok:
            print(f"Success! Frame shape: {frame.shape}")
        else:
            print("Failed to read frame")
    cap.release()
