"""
Gesture engine:
- Loads all gesture modules from backend/gestures
"""

import os
import importlib
import inspect

# Build ABSOLUTE path to gestures folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GESTURE_DIR = os.path.join(BASE_DIR, "gestures")


class GestureEngine:
    def __init__(self):
        self.gestures = []
        self.load_gestures()

    def load_gestures(self):
        print("[GestureEngine] Loading gesture modules...")

        if not os.path.exists(GESTURE_DIR):
            print(f"[GestureEngine] ERROR: Gesture directory not found: {GESTURE_DIR}")
            return

        for folder in os.listdir(GESTURE_DIR):
            path = os.path.join(GESTURE_DIR, folder)
            if not os.path.isdir(path):
                continue

            if folder.startswith("__"):
                continue

            # Correct Python import path
            module_path = f"backend.gestures.{folder}.{folder}"

            try:
                module = importlib.import_module(module_path)

                # Load Gesture class
                for name, obj in inspect.getmembers(module):
                    if inspect.isclass(obj) and name == "Gesture":
                        self.gestures.append(obj())
                        print(f"  - Loaded gesture: {folder}")

            except Exception as e:
                print(f"[GestureEngine] Failed to load {folder}: {e}")

    def process(self, landmarks):
        for gesture in self.gestures:
            result = gesture.process(landmarks)
            if result:
                return result
        return None
