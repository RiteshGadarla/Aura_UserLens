"""
Main entry point for trailMotion backend.
Automatically fixes Python path so imports always work.
"""

import sys
import os
import asyncio

# Automatically add project root to PYTHONPATH
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from server.ws_server import start_ws_server
from core.state_manager import StateManager
from core.event_sender import EventSender
from core.gesture_loop import GestureLoop


# backend/main.py

async def main():
    print("[trailMotion] Backend starting...")

    state = StateManager()
    sender = EventSender()

    loop = GestureLoop(state, sender)

    # --- DEFINE TASKS ---
    gesture_task = asyncio.create_task(loop.start())
    # Now we capture the returned websocket task
    ws_task = start_ws_server(state, sender)

    # --- WAIT FOR EITHER TASK TO FINISH ---
    try:
        # Wait for the FIRST task to complete (e.g., gesture_loop closing via ESC)
        done, pending = await asyncio.wait(
            [gesture_task, ws_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        # --- CLEANUP ---
        print("[trailMotion] Shutting down...")

        # Stop the gesture loop (in case it wasn't the one that stopped)
        loop.stop()

        # Cancel all other pending tasks (i.e., the websocket server)
        for task in pending:
            task.cancel()

    except asyncio.CancelledError:
        print("[trailMotion] Main task cancelled.")
    finally:
        # Ensure the loop resources are released
        if loop.running:
            loop.stop()


if __name__ == "__main__":
    asyncio.run(main())