from core.hand_tracker import HandTracker
import numpy as np

def test_tracker_initialization():
    tracker = HandTracker()
    assert tracker is not None

def test_tracker_no_frame():
    tracker = HandTracker()
    assert tracker.get_landmarks(None) is None
