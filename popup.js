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

  // helper: send a message to active tab
  function sendMessageToActiveTab(message) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const tabId = tabs[0].id;
        if (typeof tabId === 'undefined') return;

        chrome.tabs.sendMessage(tabId, message, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) {
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

  // Toggle AURA on/off (updates storage; content script listens)
  toggleApplyBtn.addEventListener('change', () => {
    const enabled = toggleApplyBtn.checked;
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ aura_enabled: enabled }, () => {
        console.log('AURA popup: aura_enabled set to', enabled);
      });
    } else {
      localStorage.setItem('aura_enabled', enabled ? 'true' : 'false');
      console.log('AURA popup: aura_enabled (local) set to', enabled);
    }
  });

  // Open setup page
  openSetupBtn.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    } catch (e) {
      window.open('setup.html', '_blank');
    }

    sendMessageToActiveTab({ type: 'AURA_TOGGLE_PANEL' });
  });

  loadProfile();

  /*******************************************************
   *           AURA — SPEECH TO TEXT BUTTON
   *******************************************************/
  const micBtn = document.createElement("button");
  micBtn.textContent = "🎤 Voice Input";
  micBtn.style.width = "100%";
  micBtn.style.marginTop = "10px";
  micBtn.style.padding = "10px 12px";
  micBtn.style.border = "none";
  micBtn.style.borderRadius = "8px";
  micBtn.style.fontSize = "14px";
  micBtn.style.fontWeight = "500";
  micBtn.style.cursor = "pointer";
  micBtn.style.background = "#eef0ff";
  micBtn.style.color = "#0b1b3a";
  micBtn.style.transition = "all 0.2s ease";

  micBtn.onmouseover = () => {
    micBtn.style.background = "#dde1ff";
    micBtn.style.transform = "translateY(-1px)";
    micBtn.style.boxShadow = "0 3px 8px rgba(75,108,255,0.2)";
  };

  micBtn.onmouseout = () => {
    micBtn.style.background = "#eef0ff";
    micBtn.style.transform = "translateY(0)";
    micBtn.style.boxShadow = "none";
  };

  document.querySelector(".popup").appendChild(micBtn);

  // Toggle STT
  micBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "AURA_TOGGLE_STT" });
    });
  });
});
