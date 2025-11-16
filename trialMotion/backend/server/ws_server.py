import asyncio
import json
import websockets

WS_PORT = 8765

clients = set()


async def handler(websocket, state_manager):
    """Handle messages from a connected browser client."""
    clients.add(websocket)
    print("[WS] Client connected")

    try:
        async for msg in websocket:
            data = json.loads(msg)

            # Handle ON/OFF toggle
            if data.get("type") == "toggle":
                new_state = bool(data.get("state"))
                state_manager.set_active(new_state)

    except Exception as e:
        print("[WS] Error:", e)
    finally:
        clients.remove(websocket)
        print("[WS] Client disconnected")


def start_ws_server(state_manager, event_sender):
    async def broadcast(message: dict):
        """Send message to all connected clients."""
        dead = []
        for ws in clients:
            try:
                await ws.send(json.dumps(message))
            except:
                dead.append(ws)

        for ws in dead:
            clients.remove(ws)

    # Give gesture loop the ability to send data out
    event_sender.set_sender_func(broadcast)

    async def ws_main():
        print(f"[WS] Starting WebSocket server ws://127.0.0.1:{WS_PORT}")

        # ⭐ Correct handler signature for new websockets versions
        async def wrapper(websocket):
            await handler(websocket, state_manager)

        async with websockets.serve(
                wrapper,
                "127.0.0.1",
                WS_PORT
        ):
            await asyncio.Future()  # run forever

        await asyncio.Future()  # run forever

    return asyncio.create_task(ws_main())
