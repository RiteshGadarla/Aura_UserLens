from core.state_manager import StateManager

def test_state_toggle():
    s = StateManager()
    assert not s.is_active()
    s.set_active(True)
    assert s.is_active()
