(() => {
  'use strict';

  // IDs
  const STYLE_ID = 'aura-style-override';
  const SHADOW_STYLE_ID = 'aura-shadow-override';
  const SIDEPANEL_HOST_ID = 'aura-sidepanel-host';
  const SIDEPANEL_BACKDROP_ID = 'aura-sidepanel-backdrop';

  // State
  let currentProfile = null;
  let isEnabled = true;
  let auraPanelHost = null;
  let auraPanelIframe = null;

  // --- Safe logging helpers ---
  function safeLog(...args) { try { console.log(...args); } catch (e) {} }
  function safeWarn(...args) { try { console.warn(...args); } catch (e) {} }

  // --- Build CSS safely (returns empty string if profile missing) ---
  function buildCSS(profile) {
    if (!profile) return '';
    try {
      const disableAnim = profile.animations === false;
      const cursor = profile.cursorType || 'auto';

      // Using template and later inserted as text node to keep CSP-safe
      return `
:root {
  --aura-bg: ${profile.bgColor};
  --aura-text: ${profile.textColor};
  --aura-font: ${profile.fontFamily};
  --aura-size: ${profile.fontSize}px;
  --aura-line: ${profile.lineHeight};
  --aura-letter: ${(profile.letterSpacing || 0)}px;
  --aura-word: ${(profile.wordSpacing || 0)}px;
}
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
html, body {
  background-color: ${profile.bgColor} !important;
}
${disableAnim ? `* { animation: none !important; transition: none !important; }` : ''}
      `;
    } catch (e) {
      safeWarn('AURA buildCSS error', e);
      return '';
    }
  }

  // --- Apply style to document head (CSP-safe: text node) ---
  function injectGlobalStyle(profile) {
    try {
      const css = buildCSS(profile);
      if (!css) return;

      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();

      const style = document.createElement('style');
      style.id = STYLE_ID;
      // Use text node insertion (CSP-friendly)
      style.appendChild(document.createTextNode(css));

      const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      head.appendChild(style);
      safeLog('AURA content: applied global style');
    } catch (e) {
      safeWarn('AURA content: injectGlobalStyle error', e);
    }
  }

  // --- Inject into ShadowRoots ---
  function injectIntoShadowRoots(profile) {
    try {
      if (!profile) return;
      // walk DOM for nodes that own shadowRoot
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

      const css = buildCSS(profile);
      roots.forEach(root => {
        if (!root) return;
        if (root.querySelector(`#${SHADOW_STYLE_ID}`)) return; // avoid duplicates
        try {
          const style = document.createElement('style');
          style.id = SHADOW_STYLE_ID;
          style.appendChild(document.createTextNode(css));
          root.appendChild(style);
        } catch (ee) {
          safeWarn('AURA content: injectIntoShadowRoots append error', ee);
        }
      });

      safeLog('AURA content: injected into shadow roots');
    } catch (e) {
      safeWarn('AURA content: injectIntoShadowRoots error', e);
    }
  }

  // --- Remove any injected styles (global + shadow) ---
  function removeInjectedStyles() {
    try {
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll(`#${SHADOW_STYLE_ID}`).forEach(el => el.remove());
      safeLog('AURA content: removed injected styles');
    } catch (e) { safeWarn('AURA content: removeInjectedStyles', e); }
  }

  // --- Full apply logic (keeps state) ---
  function applyProfileToDocument(profile) {
    if (!profile) return;
    currentProfile = profile;
    try {
      // Remove existing
      document.getElementById(STYLE_ID)?.remove();
      // Apply global + shadow roots if enabled
      if (isEnabled) {
        injectGlobalStyle(profile);
        injectIntoShadowRoots(profile);
      }
    } catch (e) {
      safeWarn('AURA content: applyProfileToDocument error', e);
    }
  }

  // --- Scrape sections (headings -> sections) ---
  function scrapeSections() {
    try {
      const hs = [...document.querySelectorAll('h1,h2,h3')];
      const sections = [];
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i];
        const start = h;
        const end = hs[i+1] || null;
        let node = start.nextSibling;
        const parts = [];
        while (node && node !== end) {
          if (node.nodeType === 1) {
            const tag = node.tagName?.toLowerCase();
            if (!['nav','aside','footer','script','style','noscript'].includes(tag)) {
              parts.push(node.innerText || '');
            }
          } else if (node.nodeType === 3) {
            parts.push(node.textContent || '');
          }
          node = node.nextSibling;
        }
        const text = parts.join('\n').replace(/\s+\n/g, '\n').trim();
        if (text.length > 50) {
          sections.push({
            id: `sec_${i}`,
            heading: h.innerText.trim(),
            level: h.tagName.toLowerCase(),
            text: text.slice(0, 8000),
            anchor: h.id ? `#${h.id}` : null
          });
        }
      }
      return sections;
    } catch (e) {
      safeWarn('AURA content: scrapeSections failed', e);
      return [];
    }
  }

  // --- Single defensive message listener ---
  // Always send a response (or at least ack) to avoid "message port closed" errors.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) {
        try { sendResponse({ ok: false, error: 'no_type' }); } catch (e) {}
        return true;
      }

      // SCRAPE SECTIONS (sync)
      if (msg.type === 'AURA_SCRAPE_SECTIONS') {
        try {
          const sections = scrapeSections();
          sendResponse({ sections, url: location.href, title: document.title });
        } catch (e) {
          sendResponse({ sections: [], url: location.href, title: document.title });
        }
        return true;
      }

      // APPLY PROFILE
      if (msg.type === 'AURA_APPLY_PROFILE') {
        try {
          applyProfileToDocument(msg.profile);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return true;
      }

      // GENERIC ACK
      if (msg.type === 'AURA_TOGGLE_SOMETHING') {
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }

      // OPEN SIDE PANEL (explicit open — avoids toggle edge-cases)
      if (msg.type === 'AURA_TOGGLE_PANEL') {
        safeLog('AURA content: received AURA_TOGGLE_PANEL — opening panel');
        try {
          // Use explicit open to avoid display state edge-cases.
          auraOpenSidePanel();
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA content: auraOpenSidePanel failed', e);
          try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
        }
        return true;
      }

      // Unknown message -> ack to avoid port hang
      try { sendResponse({ ok: false, error: 'unknown_message_type' }); } catch (e) {}
      return true;
    } catch (e) {
      safeWarn('AURA content: onMessage top-level error', e);
      try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
      return true;
    }
  });

  // --- Storage helpers ---
  function getCurrentProfileForPanel() {
    return new Promise((resolve) => {
      try {
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(['aura_profile'], (res) => {
            resolve(res?.aura_profile || null);
          });
        } else {
          const raw = localStorage.getItem('aura_profile');
          try { resolve(raw ? JSON.parse(raw) : null); } catch (e) { resolve(null); }
        }
      } catch (e) {
        resolve(null);
      }
    });
  }

  // --- Side panel helpers ---
  function auraGetPanelUrl() {
    try { return chrome.runtime.getURL('sidepanel.html'); } catch (e) { return 'sidepanel.html'; }
  }

  async function auraOpenSidePanel() {
    try {
      if (document.getElementById(SIDEPANEL_HOST_ID)) {
        auraShowSidePanel();
        return;
      }

      const backdrop = document.createElement('div');
      backdrop.id = SIDEPANEL_BACKDROP_ID;
      backdrop.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,.08); z-index: 2147483646;`;
      backdrop.addEventListener('click', auraCloseSidePanel);

      auraPanelHost = document.createElement('div');
      auraPanelHost.id = SIDEPANEL_HOST_ID;
      auraPanelHost.setAttribute('role', 'dialog');
      auraPanelHost.style.cssText = `position: fixed; top: 0; right: 0; height: 100vh; width: 380px; z-index: 2147483647; display: flex; flex-direction: column; box-shadow: -4px 0 16px rgba(0,0,0,.15); border-left: 1px solid #ececec; background: #fff;`;

      auraPanelIframe = document.createElement('iframe');
      auraPanelIframe.title = 'AURA side panel';
      // Use chrome.runtime.getURL for extension pages (web_accessible_resources must include sidepanel.html)
      auraPanelIframe.src = auraGetPanelUrl();
      auraPanelIframe.style.cssText = `width:100%; height:100%; border:0; background:#fff;`;
      // IMPORTANT: do NOT set sandbox="allow-scripts allow-same-origin" — avoids sandbox escape warnings.

      document.body.appendChild(backdrop);
      document.body.appendChild(auraPanelHost);
      auraPanelHost.appendChild(auraPanelIframe);

      auraPanelIframe.addEventListener('load', async () => {
        try {
          // focus and send profile via postMessage (safe)
          auraPanelIframe.contentWindow?.focus();
          const profile = await getCurrentProfileForPanel();
          if (profile) {
            auraPanelIframe.contentWindow.postMessage({
              AURA_PROFILE_LOAD: true,
              profile: profile
            }, '*');
            safeLog('AURA content: sent profile to side panel');
          }
        } catch (e) { safeWarn('AURA content: iframe load send error', e); }
      });

      // use a single window message listener (idempotent addition)
      if (!window.__aura_panel_msg_installed) {
        window.addEventListener('message', (e) => {
          try { if (e?.data?.AURA_PANEL_CLOSE) auraCloseSidePanel(); } catch (er) {}
        }, { passive: true });
        window.__aura_panel_msg_installed = true;
      }

    } catch (e) {
      safeWarn('AURA content: auraOpenSidePanel error', e);
    }
  }

  function auraCloseSidePanel() {
    try {
      document.getElementById(SIDEPANEL_HOST_ID)?.remove();
      document.getElementById(SIDEPANEL_BACKDROP_ID)?.remove();
    } catch (e) {}
    auraPanelHost = null;
    auraPanelIframe = null;
  }

  function auraShowSidePanel() {
    const host = document.getElementById(SIDEPANEL_HOST_ID);
    const backdrop = document.getElementById(SIDEPANEL_BACKDROP_ID);
    if (host) host.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
  }

  function auraToggleSidePanel() {
    const host = document.getElementById(SIDEPANEL_HOST_ID);
    if (host && host.style.display !== 'none') auraCloseSidePanel();
    else auraOpenSidePanel();
  }

  // --- MutationObserver to inject into newly attached shadow roots (dev feature) ---
  const observer = new MutationObserver((mutations) => {
    try {
      if (!isEnabled || !currentProfile) return;
      let needsInject = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          needsInject = true;
          break;
        }
      }
      if (needsInject) {
        // small delay to let shadow attach
        setTimeout(() => injectIntoShadowRoots(currentProfile), 100);
      }
    } catch (e) { safeWarn('AURA MutationObserver error', e); }
  });

  // --- init: load storage and setup listeners ---
  function init() {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
          try {
            isEnabled = typeof res.aura_enabled !== 'undefined' ? !!res.aura_enabled : true;
            if (res && res.aura_profile && isEnabled) {
              applyProfileToDocument(res.aura_profile);
            } else if (res && res.aura_profile) {
              // keep currentProfile for later when enabled
              currentProfile = res.aura_profile;
            }
          } catch (er) { safeWarn('AURA content: storage.get callback', er); }
        });

        chrome.storage.onChanged.addListener((changes, area) => {
          try {
            if (area === 'sync' && changes.aura_profile) {
              applyProfileToDocument(changes.aura_profile.newValue);
            }
            if (area === 'sync' && changes.aura_enabled) {
              const enabled = changes.aura_enabled.newValue !== false;
              isEnabled = enabled;
              if (!enabled) {
                removeInjectedStyles();
              } else if (currentProfile) {
                applyProfileToDocument(currentProfile);
              } else {
                // try to fetch profile
                chrome.storage.sync.get(['aura_profile'], (res) => {
                  if (res && res.aura_profile) applyProfileToDocument(res.aura_profile);
                });
              }
            }
          } catch (e) { safeWarn('AURA content: storage.onChanged error', e); }
        });
      } else {
        // local fallback
        try {
          const raw = localStorage.getItem('aura_profile');
          if (raw) {
            const parsed = JSON.parse(raw);
            currentProfile = parsed;
            applyProfileToDocument(parsed);
          }
          const storedEnabled = localStorage.getItem('aura_enabled');
          isEnabled = storedEnabled === null ? true : storedEnabled !== 'false';
          if (!isEnabled) removeInjectedStyles();
        } catch (e) { safeWarn('AURA local fallback error', e); }
      }

      // start observing body for new nodes / shadow roots
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { safeWarn('AURA content: init error', e); }
  }

  // Run init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
