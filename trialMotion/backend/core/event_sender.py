"""
Sends gesture events (scroll, click, move, etc.) to browser extension.
"""

class EventSender:
    def __init__(self, send_callback=None):
        self._send = send_callback

    def set_sender_func(self, func):
        """Inject broadcast function dynamically."""
        self._send = func

    async def send(self, event_type: str, data: dict):
        if not self._send:
            return  # WS not ready yet

        message = {
            "event": event_type,
            "data": data
        }
        await self._send(message)

