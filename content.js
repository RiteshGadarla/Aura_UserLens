// content.js
(() => {
  'use strict';

  const STYLE_ID = 'aura-style-override';
  const SHADOW_STYLE_ID = 'aura-shadow-override';

  let currentProfile = null;
  let isEnabled = true;

  // === 1. Inject into Light DOM (normal pages) ===
  const injectGlobalStyle = () => {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildCSS(currentProfile);
    document.head.appendChild(style);
  };

  // === 2. Inject into ALL Shadow DOM roots ===
  const injectIntoShadowRoots = () => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      }
    );

    const roots = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) roots.push(node.shadowRoot);
    }

    roots.forEach(root => {
      if (root.querySelector(`#${SHADOW_STYLE_ID}`)) return; // avoid dupes

      const style = document.createElement('style');
      style.id = SHADOW_STYLE_ID;
      style.textContent = buildCSS(currentProfile);
      root.appendChild(style);
    });
  };

  // === 3. Build CSS string (shared) ===
  const buildCSS = (profile) => {
    if (!profile) return '';

    const disableAnim = profile.animations === false;
    const cursor = profile.cursorType || 'auto';

    return `
      *, *::before, *::after {
        cursor: ${cursor} !important;
        font-family: ${profile.fontFamily} !important;
        font-size: ${profile.fontSize}px !important;
        line-height: ${profile.lineHeight} !important;
        letter-spacing: ${(profile.letterSpacing || 0)}px !important;
        word-spacing: ${(profile.wordSpacing || 0)}px !important;
        color: ${profile.textColor} !important;
        ${disableAnim ? 'animation: none !important; transition: none !important;' : ''}
      }
      body, html {
        background-color: ${profile.bgColor} !important;
      }
      ${disableAnim ? `* { animation: none !important; transition: none !important; }` : ''}
    `;
  };

  // === 4. Apply full profile ===
  const applyProfile = (profile) => {
    if (!profile) return;
    currentProfile = profile;

    // Remove old global style
    const old = document.getElementById(STYLE_ID);
    if (old) old.remove();

    if (isEnabled) {
      injectGlobalStyle();
      injectIntoShadowRoots();
    }
  };

  // === 5. Observe DOM changes (new shadow roots) ===
  const observer = new MutationObserver((mutations) => {
    if (!isEnabled || !currentProfile) return;

    let needsInject = false;
    for (const m of mutations) {
      if (m.addedNodes.length) {
        needsInject = true;
        break;
      }
    }
    if (needsInject) {
      setTimeout(injectIntoShadowRoots, 100); // small delay to let shadow attach
    }
  });

  // === 6. Init ===
  const init = () => {
    // Load profile
    chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
      isEnabled = res.aura_enabled !== false;
      if (res.aura_profile && isEnabled) {
        applyProfile(res.aura_profile);
      }
    });

    // Listen for changes
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.aura_profile) {
        applyProfile(changes.aura_profile.newValue);
      }
      if (changes.aura_enabled) {
        isEnabled = changes.aura_enabled.newValue !== false;
        if (!isEnabled) {
          document.getElementById(STYLE_ID)?.remove();
          document.querySelectorAll(`#${SHADOW_STYLE_ID}`).forEach(el => el.remove());
        } else if (currentProfile) {
          applyProfile(currentProfile);
        }
      }
    });

    // Start observing
    observer.observe(document.body, { childList: true, subtree: true });
  };

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // === Fallback for local testing ===
  if (!chrome?.storage) {
    const raw = localStorage.getItem('aura_profile');
    if (raw) applyProfile(JSON.parse(raw));
  }
})();