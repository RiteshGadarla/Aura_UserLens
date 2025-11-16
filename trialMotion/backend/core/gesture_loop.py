"""
GestureLoop
-----------
This module runs the main backend loop:
- Reads frames from Camera
- Gets landmarks via HandTracker
- Passes landmarks to GestureEngine
- Sends gesture events to extension
"""

import asyncio
import cv2

from core.camera import Camera
from core.hand_tracker import HandTracker
from core.gesture_engine import GestureEngine
import mediapipe as mp  # <--- ADD THIS

mp_drawing = mp.solutions.drawing_utils
mp_hands = mp.solutions.hands


class GestureLoop:
    def __init__(self, state_manager, event_sender):
        self.state = state_manager
        self.sender = event_sender

        self.camera = Camera()
        self.tracker = HandTracker()
        self.engine = GestureEngine()

        self.running = False

    # backend/core/gesture_loop.py
    async def start(self):
        """Start the real-time gesture loop."""
        print("[GestureLoop] Started")
        self.running = True

        while self.running:
            # Only process when ON
            if not self.state.is_active():
                await asyncio.sleep(0.05)
                continue

            frame = self.camera.read()
            if frame is None:
                continue

            # Get landmarks AND raw results from our change
            landmarks, mp_results = self.tracker.get_landmarks(frame)

            # --- NEW: Create a copy of the frame for drawing ---
            debug_frame = frame.copy()
            gesture_name = "NONE"  # Default gesture text

            # --- NEW: Draw landmarks if a hand is detected ---
            if mp_results and mp_results.multi_hand_landmarks:
                for hand_landmarks in mp_results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        debug_frame,
                        hand_landmarks,
                        mp_hands.HAND_CONNECTIONS)

            # if no hand found → skip
            if landmarks is None:
                # --- NEW: Show feedback window even if no hand ---
                cv2.imshow("trailMotion Feedback", debug_frame)
                if cv2.waitKey(5) & 0xFF == 27:  # 5ms delay, exit on ESC
                    break
                # ------------------------------------------------
                await asyncio.sleep(0.01)
                continue

            # gesture processing
            result = self.engine.process(landmarks)

            if result:
                event_type = result.get("event")
                gesture_name = event_type.upper()  # NEW: Update gesture name
                data = result.get("data", {})
                await self.sender.send(event_type, data)

            # --- NEW: Show gesture name on the frame ---
            cv2.putText(debug_frame,
                        f"Gesture: {gesture_name}",
                        (10, 30),  # Position
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1,  # Font scale
                        (0, 255, 0),  # Color (green)
                        2)  # Thickness

            # --- NEW: Show the final feedback window ---
            cv2.imshow("trailMotion Feedback", debug_frame)
            if cv2.waitKey(5) & 0xFF == 27:  # 5ms delay, exit on ESC
                break
            # -------------------------------------------

            # Short sleep to reduce CPU load
            await asyncio.sleep(0.005)

    # backend/core/gesture_loop.py
    def stop(self):
        print("[GestureLoop] Stopping...")
        self.running = False
        self.camera.release()
        cv2.destroyAllWindows()  # <--- ADD THIS LINE
