"""
Stores global ON/OFF state and shared backend flags.
"""

class StateManager:
    def __init__(self):
        self.active = False

    def set_active(self, value: bool):
        print("[State] Gesture system:", "ON" if value else "OFF")
        self.active = value

    def is_active(self):
        return self.active
