(() => {
  'use strict';

  // IDs
  const STYLE_ID = 'aura-style-override';
  const SHADOW_STYLE_ID = 'aura-shadow-override';
  const FOCUS_STYLE_ID = 'aura-focus-style';
  const SIDEPANEL_HOST_ID = 'aura-sidepanel-host';
  const SIDEPANEL_BACKDROP_ID = 'aura-sidepanel-backdrop';

  // State
  let currentProfile = null;
  let isEnabled = true;
  let auraPanelHost = null;
  let auraPanelIframe = null;
  let focusModeEnabled = false;

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

      return `
:root {
  --aura-bg: ${profile.bgColor};
  --aura-text: ${profile.textColor};
  --aura-font: ${profile.fontFamily};
  --aura-size: ${profile.fontSize}px;
  --aura-line: ${profile.lineHeight};
  --aura-letter: ${(profile.letterSpacing || 0)}px;
  --aura-word: ${(profile.wordSpacing || 0)}px;
  --aura-link: ${profile.linkColor || '#1a0dab'};
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
a, a * {
  color: var(--aura-link) !important;
}
${disableAnim ? `* { animation: none !important; transition: none !important; }` : ''}
      `;
    } catch (e) {
      safeWarn('AURA buildCSS error', e);
      return '';
    }
  }

  // ---------- Focus Mode: overlay + sanitized clone approach ----------
  // Build CSS for the focus overlay (single elevated card)
  function buildFocusOverlayCSS(profile) {
    const bg = profile?.bgColor || '#fffbe6';
    const text = profile?.textColor || '#0b1b3a';
    const size = profile?.fontSize ? `${profile.fontSize}px` : '20px';
    const line = profile?.lineHeight || 1.6;
    const link = profile?.linkColor || '#165788';

    return `
/* AURA Focus Overlay (single elevated card) */
#aura-focus-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px;
  z-index: 2147483660;
  background: rgba(0,0,0,0.55);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* The single elevated card */
#aura-focus-card {
  width: min(1100px, 92%);
  max-height: calc(100vh - 96px);
  overflow: auto;
  background: ${bg};
  color: ${text};
  font-size: ${size};
  line-height: ${line};
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 30px 80px rgba(6,12,34,0.55);
  -webkit-overflow-scrolling: touch;
  position: relative;
  border: 1px solid rgba(0,0,0,0.06);
}

/* content inside the card should not inherit site-wide heavy backgrounds */
#aura-focus-card * {
  background: transparent !important;
  box-shadow: none !important;
  text-shadow: none !important;
}

/* style common elements inside clone for readability */
#aura-focus-card p, #aura-focus-card h1, #aura-focus-card h2, #aura-focus-card h3,
#aura-focus-card li, #aura-focus-card blockquote {
  color: ${text} !important;
}

/* links inside focused clone */
#aura-focus-card a, #aura-focus-card a * {
  color: ${link} !important;
  text-decoration: underline !important;
  transition: none !important;
}

/* images inside card */
#aura-focus-card img {
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  margin: 12px 0 !important;
}

/* floating toolbar (exit button + small controls) */
#aura-focus-toolbar {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 2147483665;
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

#aura-focus-toolbar button {
  background: rgba(255,255,255,0.95);
  border: 1px solid rgba(0,0,0,0.08);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

/* respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  #aura-focus-overlay, #aura-focus-card { transition: none !important; }
}
`;
  }

  // Helper: sanitize a cloned node (remove scripts, forms' actions, iframes optionally)
  function sanitizeClone(node) {
    try {
      node.querySelectorAll('script, style').forEach(el => el.remove());

      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null, false);
      const removeAttrs = ['onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave', 'onerror', 'onfocus', 'onblur'];
      while (walker.nextNode()) {
        const el = walker.currentNode;
        for (const a of Array.from(removeAttrs)) {
          if (el.hasAttribute && el.hasAttribute(a)) el.removeAttribute(a);
        }
        if (el.tagName && el.tagName.toLowerCase() === 'iframe') {
          el.remove();
        }
        if (el.tagName && el.tagName.toLowerCase() === 'form') {
          el.removeAttribute('action');
          el.setAttribute('onsubmit', 'return false');
        }
        // Remove inline styles that force heavy backgrounds
        if (el.style && el.style.backgroundImage) {
          el.style.backgroundImage = 'none';
        }
      }
    } catch (e) {
      safeWarn('AURA sanitizeClone error', e);
    }
    return node;
  }

  // Create overlay, clone content into card, and hide originals (non-destructively)
  function injectFocusStyle(profile) {
    try {
      removeFocusStyle(false); // clean state but don't clear storage by default

      const target = findMainContentCandidate() || document.body;
      if (!target) {
        safeWarn('AURA focus: no target element found - aborting overlay creation');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'aura-focus-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'AURA Focus Mode overlay');

      const card = document.createElement('div');
      card.id = 'aura-focus-card';
      card.tabIndex = 0;

      const clone = target.cloneNode(true);
      sanitizeClone(clone);

      // If clone is a huge wrapper, try to find common inner content to show first
      const innerCandidate = clone.querySelector('article, .entry-content, .post-content, #article, .content, .post');
      const contentToAppend = innerCandidate ? innerCandidate.cloneNode(true) : clone;
      sanitizeClone(contentToAppend);

      card.appendChild(contentToAppend);

      const toolbar = document.createElement('div');
      toolbar.id = 'aura-focus-toolbar';
      const exitBtn = document.createElement('button');
      exitBtn.textContent = 'Exit Focus';
      exitBtn.addEventListener('click', () => {
        try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ type: 'AURA_FOCUS_EXIT' }); } catch (e) {}
        removeFocusStyle();
      });
      const revealBtn = document.createElement('button');
      revealBtn.textContent = 'Reveal original';
      let revealed = false;
      revealBtn.addEventListener('click', () => {
        revealed = !revealed;
        if (revealed) {
          removeFocusStyle(false); // remove overlay but don't clear storage
        } else {
          // re-inject with same profile
          injectFocusStyle(profile || currentProfile || {});
        }
      });

      toolbar.appendChild(exitBtn);
      toolbar.appendChild(revealBtn);

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(toolbar);
      overlay.appendChild(card);

      const css = buildFocusOverlayCSS(profile || currentProfile || {});
      const style = document.createElement('style');
      style.id = FOCUS_STYLE_ID;
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);

      // Hide other body children (store previous state)
      const toHide = [];
      for (const child of Array.from(document.body.children)) {
        if (child === overlay || child === toolbar) continue;
        toHide.push(child);
      }
      window.__aura_focus_hidden = toHide.map(n => {
        const prev = {
          node: n,
          prevVisibility: n.style.visibility || '',
          prevDisplay: n.style.display || '',
          prevAriaHidden: n.getAttribute('aria-hidden')
        };
        n.style.visibility = 'hidden';
        n.style.display = n.style.display || '';
        try { n.setAttribute('aria-hidden', 'true'); } catch (e) {}
        return prev;
      });

      try { card.scrollTop = 0; } catch (e) {}

      focusModeEnabled = true;
      safeLog('AURA content: injected Focus overlay');
    } catch (e) {
      safeWarn('AURA content: injectFocusStyle (overlay) error', e);
    }
  }

  // Remove overlay and restore page; if clearStorage === true (default) also clear aura_focus storage
  function removeFocusStyle(clearStorage = true) {
    try {
      const s = document.getElementById(FOCUS_STYLE_ID);
      if (s) s.remove();

      const overlay = document.getElementById('aura-focus-overlay');
      if (overlay) overlay.remove();
      const toolbar = document.getElementById('aura-focus-toolbar');
      if (toolbar) toolbar.remove();

      if (window.__aura_focus_hidden && Array.isArray(window.__aura_focus_hidden)) {
        for (const item of window.__aura_focus_hidden) {
          try {
            item.node.style.visibility = item.prevVisibility || '';
            item.node.style.display = item.prevDisplay || '';
            if (item.prevAriaHidden === null || typeof item.prevAriaHidden === 'undefined') {
              item.node.removeAttribute('aria-hidden');
            } else {
              item.node.setAttribute('aria-hidden', item.prevAriaHidden);
            }
          } catch (e) {}
        }
      }
      window.__aura_focus_hidden = null;

      if (clearStorage) {
        try {
          if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ aura_focus: false }, () => {});
          }
        } catch (e) { /* ignore */ }
      }

      focusModeEnabled = false;
      safeLog('AURA content: removed Focus overlay and restored page');
    } catch (e) {
      safeWarn('AURA content: removeFocusStyle (overlay) error', e);
    }
  }

  // --- Find the best candidate for main content ---
  function findMainContentCandidate() {
    try {
      const selectors = [
        'article[role="article"]',
        'article[role="main"]',
        'article',
        'main[role="main"]',
        'main',
        '[role="main"]',
        '.article',
        '.post',
        '.entry-content',
        '#content',
        '#main',
        '.blog-post'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el) && hasReadableText(el)) return el;
      }

      const candidates = [...document.body.querySelectorAll('div, section, article, main')].filter(isVisible);
      let best = null;
      let bestScore = 0;
      for (const el of candidates) {
        const text = (el.innerText || '').trim();
        const rect = el.getBoundingClientRect();
        const area = Math.max(0, rect.width * rect.height);
        const score = (text.length * 3) + Math.floor(area / 1000);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best || document.body;
    } catch (e) {
      safeWarn('AURA findMainContentCandidate failed', e);
      return document.body;
    }
  }

  function isVisible(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 20) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasReadableText(el) {
    try {
      const text = (el.innerText || '').trim();
      return text.length > 200;
    } catch (e) {
      return false;
    }
  }

  // --- Inject extension @font-face into the page ---
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

  // ---------- Updated applyProfileToDocument ----------
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
            try {
              chrome.storage && chrome.storage.local && chrome.storage.local.get(['aura_focus'], (d) => {
                if (d && d.aura_focus) {
                  injectFocusStyle(profile);
                }
              });
            } catch (e) { /* ignore */ }
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

      if (msg.type === 'AURA_SET_FOCUS') {
        try {
          const enabled = !!msg.enabled;
          try {
            if (chrome && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ aura_focus: enabled }, () => {});
            }
          } catch (e) { /* ignore */ }

          if (enabled) {
            if (currentProfile) {
              injectFocusStyle(currentProfile);
            } else {
              try {
                if (chrome && chrome.storage && chrome.storage.sync) {
                  chrome.storage.sync.get(['aura_profile'], (res) => {
                    injectFocusStyle(res?.aura_profile || null);
                  });
                } else {
                  const raw = localStorage.getItem('aura_profile');
                  injectFocusStyle(raw ? JSON.parse(raw) : null);
                }
              } catch (e) {
                injectFocusStyle(null);
              }
            }
          } else {
            removeFocusStyle();
          }

          sendResponse({ ok: true, enabled });
        } catch (e) {
          safeWarn('AURA content: AURA_SET_FOCUS handler failed', e);
          try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
        }
        return true;
      }

      if (msg.type === 'AURA_FOCUS_EXIT') {
        try {
          removeFocusStyle();
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA content: AURA_FOCUS_EXIT handler failed', e);
          try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
        }
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

  // --- MutationObserver to inject into newly attached shadow roots ---
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

      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['aura_focus'], (d) => {
            if (d && d.aura_focus) {
              if (currentProfile) injectFocusStyle(currentProfile);
              else {
                if (chrome && chrome.storage && chrome.storage.sync) {
                  chrome.storage.sync.get(['aura_profile'], (res) => {
                    injectFocusStyle(res?.aura_profile || null);
                  });
                } else {
                  const raw = localStorage.getItem('aura_profile');
                  injectFocusStyle(raw ? JSON.parse(raw) : null);
                }
              }
            }
          });
        }
      } catch (e) { /* ignore */ }

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

      popup.addEventListener('pointerdown', (e) => {
        _auraSuppressHide = true;
        e.stopPropagation();
      }, true);
      popup.addEventListener('pointerup', (e) => {
        setTimeout(() => { _auraSuppressHide = false; }, 150);
        e.stopPropagation();
      }, true);
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

    // Minimal safe proxy caller (your server code is expected at /ask)
    async function callProxyForText({ question, selectionText }) {
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
          const txt = await resp.text().catch(() => '');
          return { rawText: txt };
        });
        return json;
      }

      const basePayload = {
        question,
        sections: [{ heading: 'selection', text: selectionText, anchor: null }],
        pageInfo: { url: location.href, title: document.title }
      };

      try {
        const result = await doPost(basePayload);
        const details = (result && result.details && String(result.details).trim()) ? String(result.details).trim() : '';
        const tldr = (result && result.tldr && String(result.tldr).trim()) ? String(result.tldr).trim() : '';
        const bullets = Array.isArray(result.bullets) ? result.bullets.map(b => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean) : [];
        let chosen = details || tldr || (bullets.length ? bullets.join(' ') : '') || (result.rawText || '');

        const detailsIndicateNoSimplify = /no explicitly simplified version/i.test(details || '') ||
                                          /no simplified/i.test(details || '');

        if ((!chosen || chosen.trim().length === 0) || detailsIndicateNoSimplify) {
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
              if (rBullets && rBullets.length) return rBullets.join(' ');
              if (retryChosen && retryChosen.trim()) return retryChosen.trim();
              return selectionText;
            }
          } catch (retryErr) {
            if (chosen && chosen.trim().length > 0) return chosen;
            const err = new Error(String(retryErr.message || retryErr));
            err.isProxyUnavailable = /Failed to fetch/i.test(String(retryErr.message || retryErr));
            throw err;
          }
        }

        return chosen.trim();
      } catch (e) {
        safeWarn('AURA selection: callProxyForText failed in enhanced handler', e);
        const err = new Error(e.message || 'Failed to fetch');
        err.isProxyUnavailable = (e instanceof TypeError) || /Failed to fetch/i.test(String(e.message || e));
        throw err;
      }
    }

    function sanitizeModelOutput(text) {
      if (!text || typeof text !== 'string') return text || '';
      let s = text.trim();
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
      s = s.replace(/^\s*\[?CONTEXT_BLOCK_\d+\]?\s*[:\-]?\s*/i, '').trim();
      s = s.replace(/^CONTEXT_BLOCK_\d+\s*[:\-]?\s*/i, '').trim();
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

    async function onTranslateSelect(e) {
      e.stopPropagation();
      const lang = e.target.value;
      if (!lang) return;
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

    function onDocMouseDown(e) {
      const popup = document.getElementById(POPUP_ID);
      if (!popup) return;
      if (!popup.contains(e.target)) removePopup();
    }

    function onSelectionChangeTrigger() {
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

    document.addEventListener('mouseup', onSelectionChangeTrigger, true);
    document.addEventListener('keyup', onSelectionChangeTrigger, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('scroll', removePopup, true);

    window.__aura_remove_selection_popup = removePopup;

  })();

})();
