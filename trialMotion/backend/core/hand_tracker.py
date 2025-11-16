"""
MediaPipe Hand Tracking Implementation
--------------------------------------
This module:
- Loads MediaPipe Hands model
- Processes frames
- Returns normalized landmarks (21 points)
"""

import mediapipe as mp
import cv2


class HandTracker:
    def __init__(self, max_hands=1, detection_conf=0.6, tracking_conf=0.6):
        self.max_hands = max_hands

        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(
            max_num_hands=max_hands,
            model_complexity=1,
            min_detection_confidence=detection_conf,
            min_tracking_confidence=tracking_conf
        )

        # backend/core/hand_tracker.py

    def get_landmarks(self, frame):
        """
        Input:
            frame (BGR image from OpenCV)

        Output:
            (list of (x, y, z) tuples OR None, mp_results object)
        """

        if frame is None:
            return None, None  # Return two Nones

        # Convert BGR -> RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Process frame
        results = self.hands.process(rgb)

        # No hands detected
        if not results.multi_hand_landmarks:
            return None, results  # Return None for landmarks, but results for drawing

        # Only use first detected hand (for now)
        hand = results.multi_hand_landmarks[0]

        # Normalize landmarks
        landmarks = []
        for lm in hand.landmark:
            landmarks.append((lm.x, lm.y, lm.z))

        return landmarks, results  # Return both
