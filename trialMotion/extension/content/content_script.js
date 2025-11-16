// extension/content/content_script.js (NEW VERSION)

console.log("[trailMotion] content script loaded");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.event) return;

    // Dynamically create the handler name
    // e.g., "scroll" -> "handleScroll"
    // e.g., "click"  -> "handleClick"
    const handlerName = "handle" + msg.event.charAt(0).toUpperCase() + msg.event.slice(1);

    try {
        // Check if the handler function exists on the window
        if (typeof window[handlerName] === "function") {
            // Call the correct handler (e.g., window.handleScroll or window.handleClick)
            window[handlerName](msg.data);
        } else {
            console.warn(`[trailMotion] Unknown event: ${msg.event} (Handler ${handlerName} not found)`);
        }
    } catch (e) {
        console.error(`[trailMotion] error in ${handlerName}:`, e);
    }
});