// popup.js (UPDATED)
document.addEventListener('DOMContentLoaded', () => {
  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');
  const toggleApplyBtn = document.getElementById('toggleApply');
  const toggleEmotionBtn = document.getElementById('toggleEmotion'); // NEW

  function loadProfile() {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['aura_profile', 'aura_enabled', 'aura_emotion_aware'], (res) => {
        if (res && res.aura_profile) {
          const p = res.aura_profile;
          currentProfileEl.textContent = `Profile: ${p.name || 'Custom'}`;
        } else {
          currentProfileEl.textContent = 'No profile set';
        }
        toggleApplyBtn.checked = res.aura_enabled !== false; // Default true
        toggleEmotionBtn.checked = !!res.aura_emotion_aware;
      });
    } else {
      const p = JSON.parse(localStorage.getItem('aura_profile') || 'null');
      currentProfileEl.textContent = p ? `Profile: ${p.name || 'Custom'}` : 'No profile set';
      toggleApplyBtn.checked = localStorage.getItem('aura_enabled') !== 'false';
      toggleEmotionBtn.checked = localStorage.getItem('aura_emotion_aware') === 'true';
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

  // Toggle AURA on/off (existing)
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

  // NEW: Emotion-aware toggle
  toggleEmotionBtn.addEventListener('change', () => {
    const enabled = toggleEmotionBtn.checked;
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ aura_emotion_aware: enabled }, () => {
        console.log('AURA popup: aura_emotion_aware set to', enabled);
        // ask content script to run replacement now (best-effort)
        if (enabled) sendMessageToActiveTab({ type: 'AURA_RUN_EMOTION_REPLACE' });
      });
    } else {
      localStorage.setItem('aura_emotion_aware', enabled ? 'true' : 'false');
      console.log('AURA popup: aura_emotion_aware (local) set to', enabled);
    }

  });

  // Open setup page (unchanged)
  openSetupBtn.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    } catch (e) {
      window.open('setup.html', '_blank');
    }
    sendMessageToActiveTab({ type: 'AURA_TOGGLE_PANEL' });
  });

  loadProfile();
});
