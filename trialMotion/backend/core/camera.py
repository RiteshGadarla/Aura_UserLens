"""
Handles webcam capture.
"""

import cv2

class Camera:
    def __init__(self, index=0):
        self.cap = cv2.VideoCapture(index)

    def read(self):
        """Return a frame or None if failed."""
        ok, frame = self.cap.read()
        return frame if ok else None

    def release(self):
        self.cap.release()
