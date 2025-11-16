import asyncio
import websockets
import json

async def test():
    ws = await websockets.connect("ws://127.0.0.1:8765")
    print("CONNECTED!")

    # Send ON
    await ws.send(json.dumps({"type": "toggle", "state": True}))

    # Listen for events from backend
    while True:
        msg = await ws.recv()
        print("RECEIVED:", msg)

asyncio.run(test())
