// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');
  const toggleApplyBtn = document.getElementById('toggleApply');

  function loadProfile() {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
        if (res && res.aura_profile) {
          const p = res.aura_profile;
          currentProfileEl.textContent = `Profile: ${p.name || 'Custom'}`;
        } else {
          currentProfileEl.textContent = 'No profile set';
        }
        toggleApplyBtn.checked = res.aura_enabled !== false; // Default true
      });
    } else {
      const p = JSON.parse(localStorage.getItem('aura_profile') || 'null');
      currentProfileEl.textContent = p ? `Profile: ${p.name || 'Custom'}` : 'No profile set';
      toggleApplyBtn.checked = localStorage.getItem('aura_enabled') !== 'false';
    }
  }

  // helper: send a message to active tab (safe checks included)
  function sendMessageToActiveTab(message) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const tabId = tabs[0].id;
        if (typeof tabId === 'undefined') return;
        chrome.tabs.sendMessage(tabId, message, (resp) => {
          // avoid throwing on extension pages / errors
          const err = chrome.runtime.lastError;
          if (err) {
            // it's normal if content script isn't injected on some pages
            console.warn('AURA popup: sendMessageToActiveTab error', err.message);
          } else {
            console.log('AURA popup: sent message', message, 'resp:', resp);
          }
        });
      });
    } catch (e) {
      console.warn('AURA popup: sendMessageToActiveTab exception', e);
    }
  }

  // Toggle AURA on/off (updates storage; content script listens to storage.onChanged)
  toggleApplyBtn.addEventListener('change', () => {
    const enabled = toggleApplyBtn.checked;
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ aura_enabled: enabled }, () => {
        // No need to send a custom message for enabling/disabling because
        // content.js already listens to storage.onChanged.
        console.log('AURA popup: aura_enabled set to', enabled);
      });
    } else {
      localStorage.setItem('aura_enabled', enabled ? 'true' : 'false');
      console.log('AURA popup: aura_enabled (local) set to', enabled);
    }
  });

  // Open setup page — ALSO send a toggle-panel message if the content script is present.
  openSetupBtn.addEventListener('click', () => {
    // 1) Open the setup page in a new tab (same as before)
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    } catch (e) {
      // fallback for local testing
      window.open('setup.html', '_blank');
    }

    // 2) Try to tell the active page to open the side panel (non-breaking; best-effort)
    // This uses the message type your content script listens for:
    sendMessageToActiveTab({ type: 'AURA_TOGGLE_PANEL' });
  });

  loadProfile();
});
