console.log("[trailMotion SW] starting");

let socket = null;
let reconnectTimeout = 1000;

function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("[trailMotion SW] WS already open");
        return;
    }

    console.log("[trailMotion SW] connecting to ws://127.0.0.1:8765");

    socket = new WebSocket("ws://127.0.0.1:8765");

    socket.onopen = () => {
        console.log("[trailMotion SW] WS connected");
    };

    socket.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            // Broadcast to all tabs
            chrome.tabs.query({}, (tabs) => {
                for (const tab of tabs) {
                    // only send to normal tabs (ignore extension pages)
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, msg, (resp) => {
                            // ignore callback errors (tab may not be ready)
                        });
                    }
                }
            });
        } catch (e) {
            console.error("[trailMotion SW] WS onmessage parse error:", e);
        }
    };

    socket.onclose = (ev) => {
        console.warn("[trailMotion SW] WS closed, will reconnect", ev.code, ev.reason);
        socket = null;
        setTimeout(connectWebSocket, reconnectTimeout);
    };

    socket.onerror = (e) => {
        console.error("[trailMotion SW] WS error", e);
        // socket will be closed -> onclose will schedule reconnect
    };
}

// Start WS as soon as service worker loads
connectWebSocket();

// Handle messages from popup or other extension parts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "toggle") {
        // Forward toggle to backend via WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "toggle", state: !!msg.state }));
            sendResponse({ ok: true });
        } else {
            sendResponse({ ok: false, error: "ws-not-open" });
        }
    }

    // allow async response
    return true;
});
