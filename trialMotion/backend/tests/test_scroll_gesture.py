from backend.gestures.scroll.scroll import Gesture

def test_scroll_basic():
    g = Gesture()

    # Simulate finger moving down
    fake_landmarks = [(0,0,0)]*21
    fake_landmarks[8] = (0.5, 0.5, 0)   # initial
    g.process(fake_landmarks)

    fake_landmarks[8] = (0.5, 0.6, 0)   # moved down
    event = g.process(fake_landmarks)

    assert event is not None
    assert event["event"] == "scroll"
    assert "amount" in event["data"]
