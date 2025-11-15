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

  // ---------- Emotion-aware filtering utilities ----------
  const EMOTION_IGNORE_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','VIDEO','AUDIO','CANVAS','META','LINK','HEAD','SVG']);
  const EMOTION_ATTRIBUTES = ['alt','title','placeholder','aria-label','aria-describedby'];

  function isEditable(node) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName && el.tagName.toLowerCase();
    return (tag === 'input' || tag === 'textarea' || tag === 'select');
  }

  function reEscape(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Preserve capitalization: if original all caps -> upper; Title Case -> Title Case; else return as replacement normally
  function preserveCaseReplace(match, replacement) {
    try {
      if (!match || !replacement) return replacement || match;
      if (match.toUpperCase() === match) return replacement.toUpperCase();
      if (match[0] && match[0].toUpperCase() === match[0] && match.slice(1).toLowerCase() === match.slice(1)) {
        // Title case
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    } catch (e) { return replacement; }
  }

  // --- Snapshot maps to allow revert ---
  // Use Map with node keys; for nodes we can use Map (not WeakMap) so we can iterate when restoring.
  // We will remove entries for nodes that are no longer in document when restoring.
  const originalTextMap = new Map();     // key: Text Node -> original text
  const originalAttrMap = new Map();     // key: Element -> { attrName: originalValue, ... }

  function saveOriginalTextNode(node) {
    try {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      if (!originalTextMap.has(node)) originalTextMap.set(node, node.nodeValue);
    } catch (e) { safeWarn('AURA saveOriginalTextNode failed', e); }
  }

  function saveOriginalAttribute(el, attrName, value) {
    try {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      let m = originalAttrMap.get(el);
      if (!m) { m = {}; originalAttrMap.set(el, m); }
      if (!(attrName in m)) m[attrName] = value;
    } catch (e) { safeWarn('AURA saveOriginalAttribute failed', e); }
  }

  function restoreReplacements() {
    try {
      // Restore text nodes
      for (const [node, originalValue] of Array.from(originalTextMap.entries())) {
        try {
          if (node && node.nodeType === Node.TEXT_NODE) {
            // Only restore if the node is still connected
            if (node.isConnected) node.nodeValue = originalValue;
            originalTextMap.delete(node);
          }
        } catch (e) { /* ignore individual failures */ }
      }
      // Restore attributes
      for (const [el, attrs] of Array.from(originalAttrMap.entries())) {
        try {
          if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            originalAttrMap.delete(el);
            continue;
          }
          if (!el.isConnected) {
            originalAttrMap.delete(el);
            continue;
          }
          for (const attrName of Object.keys(attrs)) {
            try {
              const originalVal = attrs[attrName];
              if (typeof originalVal === 'undefined' || originalVal === null) {
                try { el.removeAttribute(attrName); } catch (e) {}
              } else {
                try { el.setAttribute(attrName, originalVal); } catch (e) {}
              }
            } catch (e) {}
          }
          originalAttrMap.delete(el);
        } catch (e) {}
      }

      // Clear maps (should be empty now)
      originalTextMap.clear();
      originalAttrMap.clear();

      safeLog('AURA: restored original text and attributes (undo complete)');
    } catch (e) {
      safeWarn('AURA restoreReplacements failed', e);
    }
  }

  // --- Replacement engine (loads mapping asynchronously from file / storage) ---
  const MAPPING_FILE = 'aura_mapping.json'; // packaged file (change if needed)
  let AURA_MAP = null;          // mapping object once loaded
  let AURA_RE = null;           // compiled regex that captures base + suffix

  // Build regex: capture (prefix non-word), (base token), optional suffix group, lookahead for boundary.
  // We'll match suffixes like ing, ed, s, es, er, est, ly, and possessive 's
  function buildRegexFromMap(map) {
    try {
      const keys = Object.keys(map).map(k => k.toLowerCase());
      // Sort longer keys first so multi-word / longer keys match before substrings
      keys.sort((a,b) => b.length - a.length);
      const escaped = keys.map(k => reEscape(k));
      // create a group for suffixes (common forms)
      const suffixGroup = "(?:('s)|(?:ing|ed|es|s|er|est|ly))?"; // captures possessive in group1 if present
      // Use Unicode aware property if supported
      try {
        return new RegExp(`(^|[^\\p{L}0-9])(${escaped.join('|')})(${suffixGroup})(?=[^\\p{L}0-9]|$)`, 'giu');
      } catch (e) {
        // fallback without Unicode property escapes
        return new RegExp(`(^|[^A-Za-z0-9])(${escaped.join('|')})(${suffixGroup})(?=[^A-Za-z0-9]|$)`, 'gi');
      }
    } catch (e) {
      safeWarn('AURA buildRegexFromMap failed', e);
      return null;
    }
  }

  // Small helper to transform suffix for replacement (heuristic rules)
  function transformSuffixForReplacement(replacementBase, suffix, originalBase) {
    if (!suffix) return '';
    suffix = String(suffix || '');
    // possessive ( 's )
    if (suffix === "'s" || suffix === "’s") return "'s";

    const s = suffix.toLowerCase();

    // helper to judge vowels
    const isVowel = (c) => 'aeiou'.indexOf(c.toLowerCase()) !== -1;

    // 'ing' rules
    if (s === 'ing') {
      // if replacement ends with 'e' (not 'ee') drop 'e' + 'ing' -> bake -> baking
      if (replacementBase.length > 1 && replacementBase.endsWith('e') && !replacementBase.endsWith('ee')) {
        return replacementBase.slice(0, -1) + 'ing';
      }
      // otherwise append ing
      return replacementBase + 'ing';
    }

    // 'ed'
    if (s === 'ed') {
      if (replacementBase.endsWith('e')) return replacementBase + 'd';
      return replacementBase + 'ed';
    }

    // comparative / superlative
    if (s === 'er') {
      return replacementBase + 'er';
    }
    if (s === 'est') {
      return replacementBase + 'est';
    }

    // adverb form 'ly'
    if (s === 'ly') {
      // if replacement ends with 'y' preceded by consonant -> replace y with i + ly
      if (replacementBase.endsWith('y') && replacementBase.length > 1 && !isVowel(replacementBase.charAt(replacementBase.length - 2))) {
        return replacementBase.slice(0, -1) + 'ily';
      }
      // if ends with 'e' -> drop 'e' + ly -> true -> truly
      if (replacementBase.endsWith('e') && !replacementBase.endsWith('ee')) {
        return replacementBase.slice(0, -1) + 'ly';
      }
      return replacementBase + 'ly';
    }

    // plural 's' / 'es'
    if (s === 's' || s === 'es') {
      const last2 = replacementBase.slice(-2).toLowerCase();
      const last1 = replacementBase.slice(-1).toLowerCase();
      if (['s','x','z'].includes(last1) || ['ch','sh'].includes(last2)) return replacementBase + 'es';
      if (replacementBase.endsWith('y') && replacementBase.length > 1 && !isVowel(replacementBase.charAt(replacementBase.length - 2))) {
        return replacementBase.slice(0, -1) + 'ies';
      }
      return replacementBase + 's';
    }

    // fallback: just append suffix to replacementBase
    return replacementBase + suffix;
  }

  // Main replace routine: uses compiled regex that captures prefix, base, suffix
  function replaceTextWithMapSync(text, map) {
    try {
      if (!text || !map || Object.keys(map).length === 0) return text;
      if (!AURA_RE) AURA_RE = buildRegexFromMap(map);
      const re = AURA_RE;
      if (!re) return text;

      // Use replace with callback to handle captured groups
      return text.replace(re, (fullMatch, prefix, matchedBase, suffixGroup) => {
        try {
          if (!matchedBase) return fullMatch;
          const lowBase = matchedBase.toLowerCase();
          // Prefer exact key in map (case-insensitive)
          let mapped = map[lowBase];
          if (!mapped) {
            // fallback: find first key matching case-insensitive
            const foundKey = Object.keys(map).find(k => k.toLowerCase() === lowBase);
            mapped = foundKey ? map[foundKey] : null;
          }
          if (!mapped) return fullMatch;

          // Decide replacement base (string)
          const replacementBase = String(mapped);

          // Transform suffix appropriately (we pass base/replacement for heuristics)
          const transformed = (suffixGroup && suffixGroup.length) ? (() => {
            // suffixGroup may include an inner capture for possessive — normalize
            let s = suffixGroup;
            s = String(s);
            const low = s.toLowerCase();
            if (low === "'s" || low === "’s") return "'s";
            if (['ing','ed','s','es','er','est','ly'].includes(low)) {
              // compute full transformed form
              const candidateFull = transformSuffixForReplacement(replacementBase, low, matchedBase);
              if (candidateFull && typeof candidateFull === 'string') {
                if (candidateFull.toLowerCase().startsWith(replacementBase.toLowerCase())) {
                  return candidateFull.slice(replacementBase.length);
                } else {
                  return low;
                }
              } else {
                return low;
              }
            }
            return s;
          })() : '';

          // Preserve case for the base only
          const preservedBase = preserveCaseReplace(matchedBase, replacementBase);

          // final suffix
          let finalSuffix = transformed;
          if (finalSuffix && suffixGroup && suffixGroup[0] && suffixGroup[0] === suffixGroup[0].toUpperCase()) {
            finalSuffix = finalSuffix.charAt(0).toUpperCase() + finalSuffix.slice(1);
          }

          return prefix + preservedBase + finalSuffix;
        } catch (err) {
          safeWarn('AURA replace callback error', err);
          return fullMatch;
        }
      });
    } catch (e) {
      safeWarn('replaceTextWithMapSync failed', e);
      return text;
    }
  }

  // ---------- Dynamic updates: observe DOM changes and attributes and apply emotion replacements ----------
  let __aura_emotion_observer = null;
  let __aura_emotion_shadow_watcher = null;

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => {
        try { fn(...args); } catch(e) { safeWarn('AURA debounce error', e); }
      }, wait);
    };
  }

  function applyMapToNodeOrSubtree(node, map) {
    try {
      if (!node || !map || Object.keys(map).length === 0) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const newText = replaceTextWithMapSync(node.nodeValue, map);
        if (newText !== node.nodeValue) {
          saveOriginalTextNode(node);
          node.nodeValue = newText;
        }
        return;
      }
      // element subtree
      runEmotionFilterOnNode(node, map);
      // attributes
      if (node.nodeType === Node.ELEMENT_NODE) {
        for (const attr of EMOTION_ATTRIBUTES) {
          if (node.hasAttribute && node.hasAttribute(attr)) {
            const val = node.getAttribute(attr);
            if (val && typeof val === 'string') {
              const replaced = replaceTextWithMapSync(val, map);
              if (replaced !== val) {
                saveOriginalAttribute(node, attr, val);
                try { node.setAttribute(attr, replaced); } catch (e) {}
              }
            }
          }
        }
      }
    } catch (e) { safeWarn('applyMapToNodeOrSubtree error', e); }
  }

  function installEmotionMutationObserver(map) {
    try {
      if (!map || Object.keys(map).length === 0) return;
      if (__aura_emotion_observer) return;

      const scheduledApply = debounce((nodes) => {
        for (const n of nodes) {
          try { applyMapToNodeOrSubtree(n, map); } catch (e) {}
        }
      }, 300);

      __aura_emotion_observer = new MutationObserver((mutations) => {
        try {
          const touched = new Set();
          for (const m of mutations) {
            if (m.type === 'characterData' && m.target) touched.add(m.target);
            if (m.addedNodes && m.addedNodes.length) {
              for (const n of m.addedNodes) {
                if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) touched.add(n);
              }
            }
            if (m.type === 'attributes' && m.target && EMOTION_ATTRIBUTES.includes(m.attributeName)) touched.add(m.target);
          }
          if (touched.size) scheduledApply(Array.from(touched));
        } catch (e) { safeWarn('AURA emotion observer callback error', e); }
      });

      __aura_emotion_observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: EMOTION_ATTRIBUTES
      });

      // Also observe shadow hosts for newly attached shadow roots and observe them similarly
      __aura_emotion_shadow_watcher = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length) {
            for (const n of m.addedNodes) {
              if (n && n.shadowRoot) {
                try {
                  __aura_emotion_observer.observe(n.shadowRoot, {
                    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: EMOTION_ATTRIBUTES
                  });
                } catch (e) { /* ignore */ }
              }
            }
          }
        }
      });
      __aura_emotion_shadow_watcher.observe(document.body, { childList: true, subtree: true });

      safeLog('AURA: emotion MutationObserver installed');
    } catch (e) {
      safeWarn('AURA: installEmotionMutationObserver failed', e);
    }
  }

  function uninstallEmotionMutationObserver() {
    try {
      if (__aura_emotion_observer) {
        try { __aura_emotion_observer.disconnect(); } catch (e) {}
        __aura_emotion_observer = null;
      }
      if (__aura_emotion_shadow_watcher) {
        try { __aura_emotion_shadow_watcher.disconnect(); } catch (e) {}
        __aura_emotion_shadow_watcher = null;
      }
      safeLog('AURA: emotion MutationObserver uninstalled');
    } catch (e) {
      safeWarn('AURA: uninstallEmotionMutationObserver failed', e);
    }
  }

  // Walk the document and safely replace text nodes
  function runEmotionFilterOnNode(root, map) {
    if (!root || !map || Object.keys(map).length === 0) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        // skip empty nodes or those in ignored tags
        if (!node || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentNode;
        const tag = parent && parent.nodeName;
        if (tag && EMOTION_IGNORE_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
        if (isEditable(parent)) return NodeFilter.FILTER_REJECT; // do not change inputs
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    const toUpdate = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      try {
        const newText = replaceTextWithMapSync(node.nodeValue, map);
        if (newText !== node.nodeValue) {
          toUpdate.push({ node, newText });
        }
      } catch (e) {
        // ignore this node and move on
      }
    }
    // Apply updates (do it after walking to avoid walker issues)
    for (const u of toUpdate) {
      try {
        saveOriginalTextNode(u.node);
        u.node.nodeValue = u.newText;
      } catch (e) { /* ignore */ }
    }
  }

  // Top-level runner: applies to body and to shadow roots
  function applyEmotionFilter(map) {
    try {
      runEmotionFilterOnNode(document.body, map);
      // attempt to inject into simple shadow roots (best-effort)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      });
      let node;
      while ((node = walker.nextNode())) {
        try {
          runEmotionFilterOnNode(node.shadowRoot, map);
        } catch (e) { /* ignore */ }
      }
    } catch (e) { console.warn('AURA emotion filter error', e); }
  }

  // Apply replacements for attributes across the document (used at initial pass)
  function applyAttributesOnDocument(map) {
    try {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (!el || typeof el.getAttribute !== 'function') continue;
        for (const attr of EMOTION_ATTRIBUTES) {
          try {
            if (el.hasAttribute(attr)) {
              const val = el.getAttribute(attr);
              if (val && typeof val === 'string') {
                const replaced = replaceTextWithMapSync(val, map);
                if (replaced !== val) {
                  saveOriginalAttribute(el, attr, val);
                  try { el.setAttribute(attr, replaced); } catch (e) {}
                }
              }
            }
          } catch (e) { /* ignore attribute errors */ }
        }
      }
    } catch (e) {
      safeWarn('AURA applyAttributesOnDocument failed', e);
    }
  }

  // helper to safely load aura_emotion_map from storage (sync fallback to local)
  function loadEmotionMapFromStorage(callback) {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['aura_emotion_map','aura_emotion_aware'], (res) => {
          const map = res?.aura_emotion_map || {};
          const enabled = !!res?.aura_emotion_aware;
          callback(enabled, map);
        });
      } else {
        const enabled = localStorage.getItem('aura_emotion_aware') === 'true';
        const map = JSON.parse(localStorage.getItem('aura_emotion_map') || '{}');
        callback(enabled, map);
      }
    } catch (e) { callback(false, {}); }
  }

  // ---------- Model / mapping loader (file first, fallback to storage) ----------
  async function fetchMappingFile() {
    try {
      const url = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL(MAPPING_FILE) : MAPPING_FILE;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`fetch mapping failed ${resp.status}`);
      const json = await resp.json();
      if (!json || typeof json !== 'object') throw new Error('mapping file invalid');
      const normalized = {};
      for (const k of Object.keys(json)) {
        const v = json[k];
        if (!v) continue;
        normalized[String(k).toLowerCase()] = String(v);
      }
      safeLog('AURA: loaded mapping file', url, Object.keys(normalized).length);
      return normalized;
    } catch (e) {
      safeWarn('AURA: fetchMappingFile failed', e);
      throw e;
    }
  }

  function loadMappingFromStorageOrFallback() {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        return new Promise((resolve) => {
          chrome.storage.sync.get(['aura_emotion_map'], (res) => {
            const m = res?.aura_emotion_map || {};
            const normalized = {};
            for (const k of Object.keys(m||{})) {
              if (!m[k]) continue;
              normalized[String(k).toLowerCase()] = String(m[k]);
            }
            resolve(normalized);
          });
        });
      } else {
        return Promise.resolve(JSON.parse(localStorage.getItem('aura_emotion_map') || '{}'));
      }
    } catch (e) {
      safeWarn('AURA loadMappingFromStorageOrFallback failed', e);
      return Promise.resolve({});
    }
  }

  async function loadMapping() {
    try {
      try {
        const map = await fetchMappingFile();
        try {
          if (chrome && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ aura_emotion_map: map }, () => safeLog('AURA: mapping saved to storage'));
          } else {
            localStorage.setItem('aura_emotion_map', JSON.stringify(map));
          }
        } catch (e) { safeWarn('AURA saving mapping failed', e); }
        return map;
      } catch (err) {
        safeWarn('AURA: mapping file fetch failed, falling back to storage', err);
        const stored = await loadMappingFromStorageOrFallback();
        return stored || {};
      }
    } catch (e) {
      safeWarn('AURA loadMapping top-level failed', e);
      return {};
    }
  }

  // Run replacement pipeline: ensure we have a mapping (load or fallback), store mapping, apply filter
  async function runEmotionReplacePipeline() {
    try {
      const getStored = () => new Promise((resolve) => {
        try {
          if (chrome && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['aura_emotion_map','aura_emotion_aware'], (res) => {
              const enabled = !!res?.aura_emotion_aware;
              const map = res?.aura_emotion_map || {};
              resolve({ enabled, map });
            });
          } else {
            const enabled = localStorage.getItem('aura_emotion_aware') === 'true';
            const map = JSON.parse(localStorage.getItem('aura_emotion_map') || '{}');
            resolve({ enabled, map });
          }
        } catch (e) { resolve({ enabled: false, map: {} }); }
      });

      const stored = await getStored();
      if (!stored.enabled) {
        safeLog('AURA: emotion mode disabled — skipping replacement pipeline');
        // If disabled, restore any previous replacements (undo)
        restoreReplacements();
        uninstallEmotionMutationObserver();
        return;
      }

      let map = stored.map || {};
      // If map is empty, attempt to load from file / storage
      if (!map || Object.keys(map).length === 0) {
        try {
          safeLog('AURA: loading mapping (file/storage)');
          const fetched = await loadMapping();
          if (fetched && Object.keys(fetched).length) {
            map = fetched;
            // Save map to storage for reuse
            try {
              if (chrome && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ aura_emotion_map: map }, () => {
                  safeLog('AURA: saved aura_emotion_map to storage');
                });
              } else {
                localStorage.setItem('aura_emotion_map', JSON.stringify(map));
              }
            } catch (e) { safeWarn('AURA: failed to save aura_emotion_map', e); }
          } else {
            safeWarn('AURA: mapping empty after load');
            return;
          }
        } catch (err) {
          safeWarn('AURA: loadMapping failed — skipping application', err);
          return;
        }
      }

      // set global map and compiled regex
      AURA_MAP = {};
      for (const k of Object.keys(map)) AURA_MAP[String(k).toLowerCase()] = String(map[k]);
      AURA_RE = buildRegexFromMap(AURA_MAP);

      // Apply filter
      applyEmotionFilter(AURA_MAP);
      try { applyAttributesOnDocument(AURA_MAP); } catch(e) { safeWarn('applyAttributes failed', e); }
      try { installEmotionMutationObserver(AURA_MAP); } catch(e) { safeWarn('AURA: failed to install emotion observer', e); }
      safeLog('AURA: emotion filter applied (replacements count unknown)');
    } catch (e) {
      safeWarn('AURA: runEmotionReplacePipeline error', e);
    }
  }

  // initial run (when content.js loads)
  loadEmotionMapFromStorage((enabled, map) => {
    if (enabled && map && Object.keys(map).length) {
      // use stored map synchronously
      AURA_MAP = {};
      for (const k of Object.keys(map)) AURA_MAP[String(k).toLowerCase()] = String(map[k]);
      AURA_RE = buildRegexFromMap(AURA_MAP);
      applyEmotionFilter(AURA_MAP);
      try { applyAttributesOnDocument(AURA_MAP); } catch (e) {}
      try { installEmotionMutationObserver(AURA_MAP); } catch (e) { /* ignore */ }
    } else if (enabled && (!map || Object.keys(map).length === 0)) {
      // If enabled but no map present, attempt to load one (fire-and-forget)
      runEmotionReplacePipeline().catch(() => {});
    } else {
      // if disabled, ensure observer is not running and revert any changes
      uninstallEmotionMutationObserver();
      restoreReplacements();
    }
  });

  // Also respond to storage changes — content.js already has storage.onChanged usage, add handling:
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (area === 'sync') {
          if (changes.aura_emotion_map || changes.aura_emotion_aware) {
            const enabled = changes.aura_emotion_aware ? !!changes.aura_emotion_aware.newValue : (localStorage.getItem('aura_emotion_aware') === 'true');
            const map = changes.aura_emotion_map ? (changes.aura_emotion_map.newValue || {}) : JSON.parse(localStorage.getItem('aura_emotion_map') || '{}');
            if (enabled && map && Object.keys(map).length) {
              // update global map & reapply
              AURA_MAP = {};
              for (const k of Object.keys(map)) AURA_MAP[String(k).toLowerCase()] = String(map[k]);
              AURA_RE = buildRegexFromMap(AURA_MAP);
              setTimeout(() => {
                applyEmotionFilter(AURA_MAP);
                try { applyAttributesOnDocument(AURA_MAP); } catch (e) {}
                try { installEmotionMutationObserver(AURA_MAP); } catch (e) { safeWarn('AURA: install observer failed on storage change', e); }
              }, 60);
            } else if (enabled && (!map || Object.keys(map).length === 0)) {
              // enabled but no mapping — attempt to fetch mapping file
              runEmotionReplacePipeline().catch(() => {});
            }
            if (!enabled) {
              // stop live sanitization; restore original text & attributes
              restoreReplacements();
              uninstallEmotionMutationObserver();
              safeLog('AURA emotion: disabled — restored original content and stopped observer');
            }
          }
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ---------- Existing CSS injection & profile logic (unchanged, but included) ----------
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

  // ---------- Consolidated defensive message listener (handles all message types) ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) {
        try { sendResponse({ ok: false, error: 'no_type' }); } catch (e) {}
        return true;
      }

      // Run emotion filter using stored map (or fetch one if missing)
      if (msg.type === 'AURA_RUN_EMOTION_FILTER' || msg.type === 'AURA_RUN_EMOTION_REPLACE' || msg.type === 'AURA_DETECT_AND_REPLACE') {
        // run pipeline (async)
        runEmotionReplacePipeline().then(() => {
          try { sendResponse({ ok: true }); } catch (e) {}
        }).catch((err) => {
          try { sendResponse({ ok: false, error: String(err) }); } catch (e) {}
        });
        return true; // will respond asynchronously
      }

      if (msg.type === 'AURA_RUN_EMOTION_RESTORE' || msg.type === 'AURA_TURN_OFF_EMOTION') {
        try {
          restoreReplacements();
          uninstallEmotionMutationObserver();
          if (chrome && chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ aura_emotion_aware: false }, ()=>{});
          else localStorage.setItem('aura_emotion_aware', 'false');
          try { sendResponse({ ok: true }); } catch(e) {}
        } catch (e) { try { sendResponse({ ok:false, error: String(e) }); } catch(e){} }
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
  // renamed to avoid name clash with emotion observer
  const shadowAttachObserver = new MutationObserver((mutations) => {
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
                // also stop emotion observer if running and restore original content
                restoreReplacements();
                uninstallEmotionMutationObserver();
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
        shadowAttachObserver.observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { safeWarn('AURA content: init error', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------- Selection popup: simplify / translate (unchanged but integrated) ----------
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
            <option value="">Translate</option>
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
        e.stopPropagation();
      }, true);
      popup.addEventListener('pointerup', (e) => {
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

    // Call proxy with clearer error handling
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

  // Expose debug helpers on the window for quick testing in console
  try {
    window.__aura_restore_replacements = restoreReplacements;
    window.__aura_clear_snapshot = () => { originalTextMap.clear(); originalAttrMap.clear(); safeLog('AURA: cleared snapshots'); };
    window.__aura_run_emotion_pipeline = runEmotionReplacePipeline;
    window.__aura_current_map = () => AURA_MAP;
  } catch (e) {}

})();
