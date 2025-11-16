// extension/ui/popup.js

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("toggleGesture");

    // Send toggle to background service worker
    toggle.addEventListener("change", async (e) => {
        const enabled = e.target.checked;
        console.log("[popup] toggle:", enabled);

        chrome.runtime.sendMessage({ type: "toggle", state: enabled }, (resp) => {
            if (chrome.runtime.lastError) {
                console.error("[popup] sendMessage error:", chrome.runtime.lastError);
                return;
            }
            console.log("[popup] backend response:", resp);
        });
    });
});
