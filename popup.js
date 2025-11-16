// popup.js — Full AURA Controls with Focus Mode
document.addEventListener('DOMContentLoaded', () => {
  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');
  const toggleApplyBtn = document.getElementById('toggleApply');
  const adblockToggle = document.getElementById('adblockToggle');
  const darkmodeToggle = document.getElementById('darkmodeToggle');
  const blockedCountEl = document.getElementById('blockedCount');
  const currentTimeEl = document.getElementById('currentTime');
  const isNightEl = document.getElementById('isNight');
  const focusToggle = document.getElementById('focusToggle');

  // Clock + Night Indicator
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    currentTimeEl.textContent = timeStr;

    const hour = now.getHours();
    const isNight = hour >= 18 || hour < 6;
    isNightEl.textContent = isNight ? 'Yes' : 'No';
    isNightEl.style.color = isNight ? '#d32f2f' : '#388e3c';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Load Profile and Focus state
  function loadProfileAndState() {
    chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
      if (res.aura_profile) {
        currentProfileEl.textContent = `Profile: ${res.aura_profile.name || 'Custom'}`;
      } else {
        currentProfileEl.textContent = 'No profile set';
      }
      toggleApplyBtn.checked = res.aura_enabled !== false;
    });

    // Focus persisted in local storage (per-machine)
    chrome.storage.local.get(['aura_focus'], (data) => {
      const focus = !!data.aura_focus;
      focusToggle.checked = focus;
      // notify active tab so the popup and content are in sync
      sendToActiveTab({ type: 'AURA_SET_FOCUS', enabled: focus });
    });
  }

  // Send message to active tab
  function sendToActiveTab(msg, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, msg, (resp) => {
          if (callback) callback(resp);
        });
      } else if (callback) {
        callback(null);
      }
    });
  }

  // === Ad Block ===
  chrome.runtime.sendMessage({ type: 'AURA_ADBLOCK_STATUS' }, (resp) => {
    if (resp) {
      adblockToggle.checked = resp.enabled;
      blockedCountEl.textContent = resp.blocked;
    }
  });

  adblockToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'AURA_ADBLOCK_TOGGLE' }, (resp) => {
      adblockToggle.checked = resp.enabled;
    });
  });

  // === Dark Mode ===
  chrome.runtime.sendMessage({ type: 'AURA_DARKMODE_STATUS' }, (resp) => {
    if (resp) darkmodeToggle.checked = resp.enabled;
  });

  darkmodeToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'AURA_DARKMODE_TOGGLE' }, (resp) => {
      darkmodeToggle.checked = resp.enabled;
    });
  });

  // === Apply AURA ===
  toggleApplyBtn.addEventListener('change', () => {
    const enabled = toggleApplyBtn.checked;
    chrome.storage.sync.set({ aura_enabled: enabled });
  });

  // === Focus Mode ===
  focusToggle.addEventListener('change', () => {
    const enabled = focusToggle.checked;
    // persist locally
    chrome.storage.local.set({ aura_focus: enabled }, () => {
      // notify the active tab immediately
      sendToActiveTab({ type: 'AURA_SET_FOCUS', enabled });
    });
  });

  // === Open Setup ===
  openSetupBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    sendToActiveTab({ type: 'AURA_TOGGLE_PANEL' });
  });

  loadProfileAndState();
});
