let socket = null;
let eventCallback = null;

export function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        return;
    }

    console.log("[trailMotion] Connecting WebSocket...");

    socket = new WebSocket("ws://127.0.0.1:8765");

    socket.onopen = () => {
        console.log("[trailMotion] WS Connected");
    };

    socket.onclose = () => {
        console.warn("[trailMotion] WS Closed. Reconnecting...");
        setTimeout(connectWebSocket, 1000);
    };

    socket.onerror = (e) => {
        console.error("[trailMotion] WS Error:", e);
    };

    socket.onmessage = (event) => {
        console.log("[trailMotion] WS Message:", event.data);
        const msg = JSON.parse(event.data);
        if (eventCallback) eventCallback(msg);
    };
}

export function onBackendEvent(cb) {
    eventCallback = cb;
}

export function sendToggle(state) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[trailMotion] WS cannot send yet");
        return;
    }

    socket.send(JSON.stringify({
        type: "toggle",
        state: state
    }));
}
