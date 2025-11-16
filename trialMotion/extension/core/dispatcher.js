// extension/core/dispatcher.js

import * as scrollGesture from "../gestures/scroll.js";

export function dispatchEvent(msg) {
    if (!msg.event) return;

    switch (msg.event) {
        case "scroll":
            scrollGesture.handleScroll(msg.data);
            break;

        default:
            console.warn("[trailMotion] Unknown event:", msg.event);
    }
}
