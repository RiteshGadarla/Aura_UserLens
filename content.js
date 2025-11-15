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

  // Interaction suppression flag (prevents popup from being removed while user interacts with it)
  let _auraSuppressHide = false;

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

  // --- Inject extension @font-face into the page (so pages can load fonts via chrome-extension:// URLs) ---
  function injectExtensionFontFaces() {
    try {
      if (document.getElementById('aura-ext-fonts')) return;

      const regularWoff2 = (chrome && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2')
        : 'fonts/OpenDyslexic-Regular.woff2';
      const regularWoff = (chrome && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff')
        : 'fonts/OpenDyslexic-Regular.woff';
      const regularTtf = (chrome && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('fonts/OpenDyslexic-Regular.ttf')
        : 'fonts/OpenDyslexic-Regular.ttf';

      const css = `
@font-face {
  font-family: 'OpenDyslexic';
  src: url('${regularWoff2}') format('woff2'),
       url('${regularWoff}') format('woff'),
       url('${regularTtf}') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
      `;

      const style = document.createElement('style');
      style.id = 'aura-ext-fonts';
      style.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(style);
      safeLog('AURA: injected extension font-face rules');
    } catch (e) {
      safeWarn('AURA: injectExtensionFontFaces failed', e);
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
        if (root.querySelector(`#${SHADOW_STYLE_ID}`)) return;
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

  // ---------- Updated applyProfileToDocument (drop-in replacement) ----------
  function applyProfileToDocument(profile) {
    if (!profile) return;
    currentProfile = profile;
    try {
      try { document.getElementById(STYLE_ID)?.remove(); } catch (e) { /* ignore */ }
      try { document.querySelectorAll(`#${SHADOW_STYLE_ID}`).forEach(el => el.remove()); } catch (e) { /* ignore */ }

      if (!isEnabled) {
        safeLog('AURA content: applyProfileToDocument skipped (disabled)');
        return;
      }

      Promise.resolve().then(() => {
        try {
          try {
            if (profile && profile.fontFamily && profile.fontFamily.toLowerCase().includes('opendyslexic')) {
              injectExtensionFontFaces();
            }
          } catch (e) { /* ignore */ }

          injectGlobalStyle(profile);

          setTimeout(() => {
            try {
              injectIntoShadowRoots(profile);
            } catch (e) {
              safeWarn('AURA content: injectIntoShadowRoots error', e);
            }
          }, 40);
        } catch (e) {
          safeWarn('AURA content: injectGlobalStyle/injectIntoShadowRoots error', e);
        }
      });
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
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) {
        try { sendResponse({ ok: false, error: 'no_type' }); } catch (e) {}
        return true;
      }

      if (msg.type === 'AURA_SCRAPE_SECTIONS') {
        try {
          const sections = scrapeSections();
          sendResponse({ sections, url: location.href, title: document.title });
        } catch (e) {
          sendResponse({ sections: [], url: location.href, title: document.title });
        }
        return true;
      }

      if (msg.type === 'AURA_APPLY_PROFILE') {
        try {
          applyProfileToDocument(msg.profile);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return true;
      }

      if (msg.type === 'AURA_TOGGLE_SOMETHING') {
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }

      if (msg.type === 'AURA_TOGGLE_PANEL') {
        safeLog('AURA content: received AURA_TOGGLE_PANEL — opening panel');
        try {
          auraOpenSidePanel();
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA content: auraOpenSidePanel failed', e);
          try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
        }
        return true;
      }

      try { sendResponse({ ok: false, error: 'unknown_message_type' }); } catch (e) {}
      return true;
    } catch (e) {
      safeWarn('AURA content: onMessage top-level error', e);
      try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
      return true;
    }
  });

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
      auraPanelIframe.src = auraGetPanelUrl();
      auraPanelIframe.style.cssText = `width:100%; height:100%; border:0; background:#fff;`;

      document.body.appendChild(backdrop);
      document.body.appendChild(auraPanelHost);
      auraPanelHost.appendChild(auraPanelIframe);

      auraPanelIframe.addEventListener('load', async () => {
        try {
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
        setTimeout(() => injectIntoShadowRoots(currentProfile), 100);
      }
    } catch (e) { safeWarn('AURA MutationObserver error', e); }
  });

  // --- init: load storage and setup listeners ---
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

  function init() {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
          try {
            isEnabled = typeof res.aura_enabled !== 'undefined' ? !!res.aura_enabled : true;
            if (res && res.aura_profile && isEnabled) {
              applyProfileToDocument(res.aura_profile);
            } else if (res && res.aura_profile) {
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
                chrome.storage.sync.get(['aura_profile'], (res) => {
                  if (res && res.aura_profile) applyProfileToDocument(res.aura_profile);
                });
              }
            }
          } catch (e) { safeWarn('AURA content: storage.onChanged error', e); }
        });
      } else {
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

      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { safeWarn('AURA content: init error', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------- Selection popup: simplify / translate ----------
  (function addSelectionPopupFeature() {
    if (window.__aura_selection_popup_installed) return;
    window.__aura_selection_popup_installed = true;

    const POPUP_ID = 'aura-selection-popup';

    const popupCss = `
      #${POPUP_ID} {
        position: absolute;
        z-index: 2147483649;
        background: #ffffff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 6px 20px rgba(2,6,23,0.12);
        border-radius: 10px;
        padding: 8px;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
        font-size: 13px;
        color: #0b1b3a;
        display: flex;
        gap: 8px;
        align-items: center;
        min-width: 220px;
        max-width: 360px;
      }
      #${POPUP_ID} button {
        background: #eef0ff;
        border: none;
        padding: 6px 8px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
      }
      #${POPUP_ID} button:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(75,108,255,0.12); }
      #${POPUP_ID} select { padding: 6px; border-radius: 6px; border: 1px solid #e6e9ef; background: white; }
      #${POPUP_ID} .aura-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #dfe6ff; border-top-color: #4b6cff; animation: aura-spin 1s linear infinite; margin-left: 6px; }
      @keyframes aura-spin { to { transform: rotate(360deg); } }
    `;

    function ensurePopupStyle() {
      if (document.getElementById('aura-selection-popup-style')) return;
      const s = document.createElement('style');
      s.id = 'aura-selection-popup-style';
      s.appendChild(document.createTextNode(popupCss));
      (document.head || document.documentElement).appendChild(s);
    }

    function createPopup() {
      removePopup();
      ensurePopupStyle();
      const popup = document.createElement('div');
      popup.id = POPUP_ID;
      popup.setAttribute('role', 'dialog');
      popup.innerHTML = `
        <button id="${POPUP_ID}-simplify">Simplify</button>
        <label style="display:flex;gap:6px;align-items:center">
          <select id="${POPUP_ID}-lang">
            <option value="">Translate ▼</option>
            <option value="hi">Hindi</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ta">Tamil</option>
            <option value="bn">Bengali</option>
            <option value="zh">Chinese (Simplified)</option>
            <option value="ar">Arabic</option>
          </select>
        </label>
        <div id="${POPUP_ID}-status" style="display:inline-flex;align-items:center"></div>
      `;
      document.body.appendChild(popup);

      // Prevent hide while interacting with popup
      popup.addEventListener('pointerdown', (e) => {
        _auraSuppressHide = true;
        // stop propagation so document mousedown handler doesn't remove popup
        e.stopPropagation();
      }, true);
      popup.addEventListener('pointerup', (e) => {
        // keep suppressed briefly to allow click/change events to register
        setTimeout(() => { _auraSuppressHide = false; }, 150);
        e.stopPropagation();
      }, true);
      // Also stopPropagation for clicks inside popup
      popup.addEventListener('mousedown', (e) => e.stopPropagation());
      popup.addEventListener('click', (e) => e.stopPropagation());

      document.getElementById(`${POPUP_ID}-simplify`).addEventListener('click', onSimplifyClick);
      document.getElementById(`${POPUP_ID}-lang`).addEventListener('change', onTranslateSelect);

      return popup;
    }

    function removePopup() {
      const old = document.getElementById(POPUP_ID);
      if (old) old.remove();
    }

    function getSelectionRange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (sel.isCollapsed || !range || range.toString().trim() === '') return null;
      return { sel, range, text: range.toString() };
    }

    function positionPopup(popup, range) {
      try {
        const rect = range.getBoundingClientRect();
        const pageX = rect.left + window.scrollX;
        const pageY = rect.top + window.scrollY;
        const preferAbove = (rect.top > 60);
        const margin = 8;
        let left = pageX + (rect.width / 2) - (popup.offsetWidth / 2);
        left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - popup.offsetWidth - 8));
        let top;
        if (preferAbove) top = pageY - popup.offsetHeight - margin;
        else top = pageY + rect.height + margin;
        if (!isFinite(top)) top = window.scrollY + 20;
        popup.style.left = `${Math.round(left)}px`;
        popup.style.top = `${Math.round(top)}px`;
      } catch (e) {
        safeWarn('AURA selection: positionPopup error', e);
      }
    }

  // --- sanitize model outputs (strip assistant framing like "The following is the translation...") ---
  function sanitizeModelOutput(text) {
    if (!text || typeof text !== 'string') return text || '';

    let s = text.trim();

    // Common framing patterns to remove (case-insensitive)
    // - "The following is the translation of the provided text (CONTEXT_BLOCK_1) into Hindi: ..."
    // - "The following is a translation of the provided text: ..."
    // - "Translation:" "Translated:" "Answer:" etc.
    const framingPatterns = [
      /^\s*the following is (?:a )?translation(?: of the provided text(?: \(?context_block_\d+\)? )?)?(?: into [^:]+)?:\s*/i,
      /^\s*the following is (?:a )?translation(?: of the provided text)?:\s*/i,
      /^\s*the following is (?:the )?translation(?:\:)?\s*/i,
      /^\s*translation\s*[:\-]\s*/i,
      /^\s*translated\s*[:\-]\s*/i,
      /^\s*answer\s*[:\-]\s*/i,
      /^\s*result\s*[:\-]\s*/i,
      /^\s*the translation is\s*[:\-]?\s*/i
    ];

    for (const re of framingPatterns) {
      if (re.test(s)) {
        s = s.replace(re, '').trim();
        break;
      }
    }

    // If model included explicit context tags like [CONTEXT_BLOCK_1] or "CONTEXT_BLOCK_1:" remove them
    s = s.replace(/^\s*\[?CONTEXT_BLOCK_\d+\]?\s*[:\-]?\s*/i, '').trim();
    s = s.replace(/^CONTEXT_BLOCK_\d+\s*[:\-]?\s*/i, '').trim();

    // Remove accidental leading punctuation leftover
    s = s.replace(/^[\s>:\-–—]+/, '').trim();

    return s;
  }

    function replaceRangeWithText(range, text) {
      try {
        const textNode = document.createTextNode(text);
        range.deleteContents();
        range.insertNode(textNode);
        const sel = window.getSelection();
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStartAfter(textNode);
        newRange.collapse(true);
        sel.addRange(newRange);
      } catch (e) {
        safeWarn('AURA selection: replaceRangeWithText failed', e);
      }
    }

    function showPopupForSelection() {
      try {
        const info = getSelectionRange();
        if (!info) { removePopup(); return; }
        const popup = createPopup();
        requestAnimationFrame(() => {
          positionPopup(popup, info.range);
        });
      } catch (e) {
        safeWarn('AURA selection: showPopupForSelection error', e);
      }
    }

    function setPopupLoading(loading, message) {
      const status = document.getElementById(`${POPUP_ID}-status`);
      if (!status) return;
      status.innerHTML = '';
      if (loading) {
        const spinner = document.createElement('div');
        spinner.className = 'aura-spinner';
        spinner.title = message || 'Processing...';
        status.appendChild(spinner);
      } else if (message) {
        status.textContent = message;
        setTimeout(() => { if (status) status.textContent = ''; }, 1500);
      }
    }

    // Call proxy with clearer error handling
    async function callProxyForText({ question, selectionText }) {
      // internal helper that performs the POST
      async function doPost(payload) {
        const resp = await fetch('http://127.0.0.1:3000/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`Proxy error ${resp.status}: ${txt.slice(0, 200)}`);
        }
        const json = await resp.json().catch(async () => {
          // fallback: try to return text if JSON parse fails
          const txt = await resp.text().catch(() => '');
          return { rawText: txt };
        });
        return json;
      }

      // Build the basic payload shape your server expects
      const basePayload = {
        question,
        sections: [{ heading: 'selection', text: selectionText, anchor: null }],
        pageInfo: { url: location.href, title: document.title }
      };

      // Try fetching once, then do a single retry with a stronger prompt if needed
      try {
        const result = await doPost(basePayload);

        // Normalize values
        const details = (result && result.details && String(result.details).trim()) ? String(result.details).trim() : '';
        const tldr = (result && result.tldr && String(result.tldr).trim()) ? String(result.tldr).trim() : '';
        const bullets = Array.isArray(result.bullets) ? result.bullets.map(b => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean) : [];

        // Choose best available output (priority: details -> tldr -> bullets -> rawText)
        let chosen = details || tldr || (bullets.length ? bullets.join(' ') : '') || (result.rawText || '');

        // If the server clearly said it did not produce a simplified version, or chosen is empty,
        // retry with an explicit instruction forcing a simplified output.
        const detailsIndicateNoSimplify = /no explicitly simplified version/i.test(details || '') ||
                                          /no simplified/i.test(details || '');

        if ((!chosen || chosen.trim().length === 0) || detailsIndicateNoSimplify) {
          // Build a strict follow-up question instructing the model to return only the simplified text
          const retryQuestion = `Please produce ONLY a plain-text simplified version of the following text for readability, following the user's accessibility preferences. Keep meaning intact, use short sentences and plain words, and do NOT include extra commentary or metadata. Return only the simplified text.`;
          const retryPayload = {
            question: retryQuestion + '\n\nOriginal request context:\n' + (question || ''),
            sections: [{ heading: 'selection', text: selectionText, anchor: null }],
            pageInfo: { url: location.href, title: document.title }
          };

          try {
            const retryResult = await doPost(retryPayload);
            const rDetails = (retryResult && retryResult.details && String(retryResult.details).trim()) ? String(retryResult.details).trim() : '';
            const rTldr = (retryResult && retryResult.tldr && String(retryResult.tldr).trim()) ? String(retryResult.tldr).trim() : '';
            const rBullets = Array.isArray(retryResult.bullets) ? retryResult.bullets.map(b => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean) : [];
            const retryChosen = rDetails || rTldr || (rBullets.length ? rBullets.join(' ') : '') || (retryResult.rawText || '');

            if (retryChosen && retryChosen.trim().length > 0) {
              return retryChosen.trim();
            } else {
              // If still empty, fall back to building a short summary from bullets or original question
              if (rBullets && rBullets.length) return rBullets.join(' ');
              if (retryChosen && retryChosen.trim()) return retryChosen.trim();
              // last resort: return original selection (so we don't null)
              return selectionText;
            }
          } catch (retryErr) {
            // If retry failed, propagate original successful result if any, otherwise throw
            if (chosen && chosen.trim().length > 0) return chosen;
            const err = new Error(String(retryErr.message || retryErr));
            err.isProxyUnavailable = /Failed to fetch/i.test(String(retryErr.message || retryErr));
            throw err;
          }
        }

        // Good result found
        return chosen.trim();
      } catch (e) {
        // Network-level or fetch errors
        safeWarn('AURA selection: callProxyForText failed in enhanced handler', e);
        const err = new Error(e.message || 'Failed to fetch');
        err.isProxyUnavailable = (e instanceof TypeError) || /Failed to fetch/i.test(String(e.message || e));
        throw err;
      }
    }

    // Simplify click handler
    async function onSimplifyClick(e) {
      e.stopPropagation();
      const info = getSelectionRange();
      if (!info) return removePopup();
      setPopupLoading(true, 'Simplifying...');
      try {
        const profile = await getCurrentProfileForPanel();
        const profileNote = profile ? `User profile: ${JSON.stringify({
          id: profile.id, name: profile.name, fontFamily: profile.fontFamily,
          fontSize: profile.fontSize, lineHeight: profile.lineHeight,
          letterSpacing: profile.letterSpacing, wordSpacing: profile.wordSpacing,
          animations: profile.animations
        })}` : '';

        const question = `Simplify the following text for readability. ${profileNote} Keep meaning intact, use short sentences, plain vocabulary, and format for readability for users with the given profile. Return the simplified text only.`;
        const simplified = await callProxyForText({ question, selectionText: info.text });
        if (simplified) replaceRangeWithText(info.range, sanitizeModelOutput(simplified));
        setPopupLoading(false, 'Done');
        removePopup();
      } catch (err) {
        setPopupLoading(false, 'Error');
        if (err.isProxyUnavailable) {
          alert('AURA: Could not reach the local proxy at http://localhost:3000. Start your server and try again.');
        } else {
          console.error(err);
          alert('AURA: Simplify failed — check console for details.');
        }
      }
    }

    // Translate handler
    async function onTranslateSelect(e) {
      e.stopPropagation();
      const lang = e.target.value;
      if (!lang) return;
      // reset select after triggering
      e.target.value = '';
      const info = getSelectionRange();
      if (!info) return removePopup();
      setPopupLoading(true, 'Translating...');
      try {
        const question = `Translate the following text to language code "${lang}". Preserve meaning and punctuation. Return only the translated text (no commentary).`;
        const translated = await callProxyForText({ question, selectionText: info.text });
        if (translated) replaceRangeWithText(info.range, sanitizeModelOutput(translated));
        setPopupLoading(false, 'Done');
        removePopup();
      } catch (err) {
        setPopupLoading(false, 'Error');
        if (err.isProxyUnavailable) {
          alert('AURA: Could not reach the local proxy at http://localhost:3000. Start your server and try again.');
        } else {
          console.error(err);
          alert('AURA: Translation failed — check console for details.');
        }
      }
    }

    // Hide popup when clicking elsewhere or when selection collapses,
    // but respect the suppression flag while interacting with popup
    function onDocMouseDown(e) {
      const popup = document.getElementById(POPUP_ID);
      if (!popup) return;
      if (!popup.contains(e.target)) removePopup();
    }

    function onSelectionChangeTrigger() {
      // If user is interacting with popup, don't hide it
      if (_auraSuppressHide) return;
      setTimeout(() => {
        const info = getSelectionRange();
        if (info) {
          showPopupForSelection();
        } else {
          removePopup();
        }
      }, 10);
    }

    document.addEventListener('mouseup', onSelectionChangeTrigger, true);
    document.addEventListener('keyup', onSelectionChangeTrigger, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('scroll', removePopup, true);

    window.__aura_remove_selection_popup = removePopup;

  })();

})();
