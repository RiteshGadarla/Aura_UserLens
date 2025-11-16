import time
from collections import deque
import math


class Gesture:
    def __init__(self):
        self.up_frames = 0
        self.down_frames = 0
        self.required_frames = 4

        self.sensitivity = 10

        # wiggle detection
        self.last_x = None
        self.wiggle_acc = 0
        self.wiggle_threshold = 0.04
        self.wiggle_decay = 0.85

        # NEW: cooldown system
        self.curl_cooldown_ms = 180     # ignore movement for 180ms
        self.last_curl_time = 0


    def is_extended(self, tip, pip):
        return tip[1] < pip[1] - 0.02

    def is_pointing_down(self, tip, pip):
        return tip[1] > pip[1] + 0.02

    def is_curled(self, tip, pip):
        return abs(tip[1] - pip[1]) < 0.015


    def detect_horizontal_wiggle(self, x):
        if self.last_x is None:
            self.last_x = x
            return False

        dx = x - self.last_x
        self.last_x = x

        self.wiggle_acc += abs(dx)
        self.wiggle_acc *= self.wiggle_decay

        return self.wiggle_acc > self.wiggle_threshold


    def process(self, landmarks):
        now = time.time() * 1000  # ms

        if landmarks is None or len(landmarks) < 9:
            self.last_x = None
            self.wiggle_acc = 0
            return None

        index_tip = landmarks[8]
        index_pip = landmarks[6]

        pointing_up = self.is_extended(index_tip, index_pip)
        pointing_down = self.is_pointing_down(index_tip, index_pip)
        curled = self.is_curled(index_tip, index_pip)

        # -----------------------------------------------------
        # 1. HANDLE CURL → RESET EVERYTHING + START COOLDOWN
        # -----------------------------------------------------
        if curled:
            self.last_curl_time = now

            # Hard reset motion data
            self.wiggle_acc = 0
            self.last_x = None

            # Reset frame counters too
            self.up_frames = 0
            self.down_frames = 0
            return None

        # -----------------------------------------------------
        # 2. IF COOLING DOWN – IGNORE ALL MOVEMENT
        # -----------------------------------------------------
        if now - self.last_curl_time < self.curl_cooldown_ms:
            return None


        # ---- stability checks ----
        if pointing_up:
            self.up_frames += 1
            self.down_frames = 0
        elif pointing_down:
            self.down_frames += 1
            self.up_frames = 0
        else:
            self.up_frames = 0
            self.down_frames = 0
            return None

        if self.up_frames < self.required_frames and self.down_frames < self.required_frames:
            return None

        # -----------------------------------------------------
        # 3. HORIZONTAL WIGGLE TRIGGER
        # -----------------------------------------------------
        x, _, _ = index_tip
        wiggle = self.detect_horizontal_wiggle(x)

        if not wiggle:
            return None

        # -----------------------------------------------------
        # 4. SCROLL AMOUNT
        # -----------------------------------------------------
        if pointing_up:
            amount = -abs(self.sensitivity * 75)
        elif pointing_down:
            amount = abs(self.sensitivity * 75)
        else:
            return None

        return {"event": "scroll", "data": {"amount": amount}}
