// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');
  const toggleApplyBtn = document.getElementById('toggleApply');

  // Load profile and toggle state
  function loadProfile() {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
        // Profile
        if (res && res.aura_profile) {
          const p = res.aura_profile;
          currentProfileEl.textContent = `Profile: ${p.name || 'Custom'}`;
        } else {
          currentProfileEl.textContent = 'No profile set';
        }
        // Toggle state
        toggleApplyBtn.checked = res.aura_enabled !== false; // Default to true
      });
    } else {
      // Local testing fallback
      const p = JSON.parse(localStorage.getItem('aura_profile') || 'null');
      currentProfileEl.textContent = p ? `Profile: ${p.name || 'Custom'}` : 'No profile set';
      toggleApplyBtn.checked = localStorage.getItem('aura_enabled') !== 'false';
    }
  }

  // Toggle AURA on/off
  toggleApplyBtn.addEventListener('change', () => {
    const enabled = toggleApplyBtn.checked;
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ aura_enabled: enabled }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleAura', enabled });
        });
      });
    } else {
      localStorage.setItem('aura_enabled', enabled);
      // Simulate message for local testing
      console.log('Toggle AURA:', enabled);
    }
  });

  // Open setup page
  openSetupBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  });

  loadProfile();
});