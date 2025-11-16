from core.gesture_engine import GestureEngine

def test_loading():
    engine = GestureEngine()
    assert len(engine.gestures) > 0
