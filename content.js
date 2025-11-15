/**
 * content.js — Part 1/4
 * AURA extension — robust global text mapping (Option B: ALL DOM text)
 * - Builds a global linear text buffer of the entire DOM (excluding scripts/styles/svg/canvas/input).
 * - Normalizes text for matching.
 * - Provides utilities to find a chunk in the global text.
 * - Provides safe style injection for highlight visuals.
 *
 * Paste Parts 1..4 in order into your content.js (or replace existing file).
 * The parts are designed to be concatenated as a single JS file.
 */

(() => {
  'use strict';

  // ---------------------------
  // IDs & global state
  // ---------------------------
  const STYLE_ID = 'aura-style-override';
  const HIGHLIGHT_CSS_ID = 'aura-tts-highlight-style';
  const SHADOW_STYLE_ID = 'aura-shadow-override';
  const SIDEPANEL_HOST_ID = 'aura-sidepanel-host';
  const SIDEPANEL_BACKDROP_ID = 'aura-sidepanel-backdrop';

  // Core state
  let currentProfile = null;
  let isEnabled = true;

  // Text mapping (global)
  let fullText = '';               // continuous concatenation of mapped node texts (normalized)
  let textNodeMap = [];            // array of { node: TextNode, start: number, end: number, text: string }
  let lastMapBuildTime = 0;        // timestamp when map was last built
  let lastMatchPosition = 0;       // heuristic pointer for searches

  // Highlight tracking
  let currentHighlightWrapper = null;
  let lastGlobalIndexHighlighted = -1;

  // DOM mutation throttling
  let rebuildScheduled = false;
  let rebuildTimeout = null;

  // Logging helpers
  function safeLog(...args) { try { console.log('[AURA]', ...args); } catch (e) {} }
  function safeWarn(...args) { try { console.warn('[AURA]', ...args); } catch (e) {} }

  // ---------------------------
  // Inject highlight CSS (blue underline style, accessible)
  // ---------------------------
  function ensureHighlightStyle() {
    try {
      if (document.getElementById(HIGHLIGHT_CSS_ID)) return;
      const css = `
/* AURA TTS highlight */
span.aura-tts-highlight, span[data-aura-tts].aura-tts-highlight {
  text-decoration: underline;
  text-decoration-thickness: 3px;
  text-decoration-color: #4b6cff;
  text-underline-offset: 3px;
  font-weight: 600;
  background: transparent !important;
  color: inherit !important;
  -webkit-text-decoration-color: #4b6cff !important;
  -webkit-text-decoration-thickness: 3px !important;
  pointer-events: none;
}
[data-aura-tts] { pointer-events: none; }
`;
      const style = document.createElement('style');
      style.id = HIGHLIGHT_CSS_ID;
      style.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {
      safeWarn('ensureHighlightStyle failed', e);
    }
  }

  // ---------------------------
  // Helper: Should node be included in mapping?
  // Option B: include ALL DOM text except a small exclusion list.
  // ---------------------------
  function nodeTagExcluded(tagName) {
    if (!tagName) return false;
    const t = tagName.toLowerCase();
    // Exclude nodes that typically contain no readable content or are structural only
    return ['script', 'style', 'noscript', 'svg', 'canvas', 'iframe'].includes(t);
  }

  function shouldIncludeTextNode(textNode) {
    try {
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
      const parent = textNode.parentElement;
      if (!parent) return false;
      if (nodeTagExcluded(parent.tagName)) return false;

      // Exclude purely whitespace nodes
      if (!textNode.textContent || !textNode.textContent.trim()) return false;

      // Option B: include even if invisible (to capture React hidden/animated content).
      // But exclude <input>/<textarea> content nodes
      if (parent.tagName && ['input', 'textarea'].includes(parent.tagName.toLowerCase())) return false;

      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------
  // Normalize text: collapse whitespace to single space, replace NBSP with space
  // Keep punctuation and characters intact — only collapse whitespace to make matching stable.
  // ---------------------------
  function normalizeTextForMap(s) {
    if (!s) return '';
    return String(s).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---------------------------
  // Build the global text node map of entire DOM (Option B: ALL DOM text)
  // Strategy:
  // - Walk text nodes via TreeWalker
  // - For each candidate text node, compute normalized text fragment and record start/end
  // - Concatenate to fullText
  // - Use a synchronous approach but with short-circuiting for massive pages
  // ---------------------------
  function buildTextNodeMap(force = false) {
    try {
      const now = Date.now();
      // avoid rebuilding too often; allow external force
      if (!force && (now - lastMapBuildTime) < 300) {
        return; // small throttle: 300ms
      }

      fullText = '';
      textNodeMap = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      let pos = 0;
      // To avoid locking UI for extremely large DOMs, we will limit per-run nodes processed and allow resumable builds.
      // But for simplicity here, attempt full walk; it's usually acceptable. If necessary, we can make this incremental.
      while ((node = walker.nextNode())) {
        try {
          if (!shouldIncludeTextNode(node)) continue;
          const raw = node.textContent || '';
          const normalized = normalizeTextForMap(raw);
          if (!normalized) continue;

          const start = pos;
          const end = start + normalized.length;
          textNodeMap.push({ node, start, end, text: normalized });
          fullText += normalized;
          pos = end;
        } catch (e) {
          // skip nodes that throw
        }
      }

      lastMapBuildTime = now;
      lastMatchPosition = 0;
      safeLog('buildTextNodeMap: chars=', fullText.length, 'nodes=', textNodeMap.length);
    } catch (e) {
      safeWarn('buildTextNodeMap failed', e);
      fullText = '';
      textNodeMap = [];
    }
  }

  // ---------------------------
  // Utility: Binary search for map entry containing given globalIndex
  // ---------------------------
  function findMapIndexByGlobalIndex(globalIndex) {
    let lo = 0, hi = textNodeMap.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const entry = textNodeMap[mid];
      if (!entry) break;
      if (globalIndex < entry.start) {
        hi = mid - 1;
      } else if (globalIndex >= entry.end) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  // ---------------------------
  // Find occurrence of chunkText inside fullText near approxStart (heuristic)
  // Returns the global start index of the chunk within fullText, or -1 if not found.
  // Uses normalized matching (collapse whitespace).
  // ---------------------------
  function findChunkInFullText(chunkText, approxStart = 0) {
    try {
      if (!chunkText) return -1;
      if (!fullText) return -1;

      const sampleNorm = normalizeTextForMap(chunkText);
      if (!sampleNorm) return -1;

      // Try searching in a window around approxStart first
      const windowRadius = 8000; // large window to handle long paragraphs
      const from = Math.max(0, Math.floor(approxStart - windowRadius));
      const to = Math.min(fullText.length, Math.floor(approxStart + windowRadius));
      const windowText = fullText.slice(from, to);

      let localIdx = windowText.indexOf(sampleNorm);
      if (localIdx !== -1) return from + localIdx;

      // fallback to global indexOf
      const globalIdx = fullText.indexOf(sampleNorm);
      if (globalIdx !== -1) return globalIdx;

      // try shorter sample (first 60 chars)
      const shortSample = sampleNorm.slice(0, 60);
      if (shortSample.length >= 8) {
        const shortIdx = fullText.indexOf(shortSample);
        if (shortIdx !== -1) return shortIdx;
      }

      return -1;
    } catch (e) {
      return -1;
    }
  }

  // ---------------------------
  // Expose small debug helpers on window (optional)
  // ---------------------------
  try {
    window.__aura_debug = window.__aura_debug || {};
    window.__aura_debug.rebuildAuraMap = () => buildTextNodeMap(true);
    window.__aura_debug.getAuraMapSummary = () => ({ chars: fullText.length, nodes: textNodeMap.length });
  } catch (e) {}

  // Ensure highlight CSS exists
  ensureHighlightStyle();

  // Initial build now to have baseline map (but map will be rebuilt right before TTS starts for best freshness)
  try { buildTextNodeMap(); } catch (e) { safeWarn('initial build failed', e); }

  // End of Part 1
})();
/**
 * content.js — Part 2/4
 * - Global highlighter engine (works across multiple text nodes)
 * - Smart scrolling (Option C)
 * - Robust wrapping of ranges that cross node boundaries
 *
 * This part depends on the mapping built in Part 1.
 */

(() => {
  'use strict';

  // Reuse variables from Part 1 scope (this file is concatenated, same closure).
  // Functions implemented here:
  // - clearAuraHighlights()
  // - highlightGlobalRange(startGlobal, endGlobal)
  // - highlightAtGlobalIndex(globalIndex)
  // - smartScrollIfNeeded(el)
  // - helper: createWrapperForNodes(partsFragment)

  // ---------- Clear previous highlights ----------
  function clearAuraHighlights() {
    try {
      // Remove wrappers with [data-aura-tts] attribute
      const wrappers = Array.from(document.querySelectorAll('[data-aura-tts]'));
      wrappers.forEach(w => {
        try {
          const parent = w.parentNode;
          if (!parent) return;
          // Replace wrapper with its text content (preserve plain text)
          const frag = document.createDocumentFragment();
          // Append each child as text nodes to preserve text order
          // But to keep it simple and robust, use textContent to collapse markup into text
          frag.appendChild(document.createTextNode(w.textContent || ''));
          parent.replaceChild(frag, w);
        } catch (e) {
          // If replace fails, try to remove safely
          try { w.remove(); } catch (ee) {}
        }
      });

      // Defensive: remove any span.aura-tts-highlight leftover
      Array.from(document.querySelectorAll('span.aura-tts-highlight')).forEach(s => {
        try {
          const parent = s.parentNode;
          if (!parent) return;
          parent.replaceChild(document.createTextNode(s.textContent || ''), s);
        } catch (e) {}
      });

      currentHighlightWrapper = null;
      lastGlobalIndexHighlighted = -1;
    } catch (e) {
      safeWarn('clearAuraHighlights error', e);
    }
  }

  // ---------- Smart scroll behavior ----------
  // If element is outside viewport, scroll it into center; otherwise do nothing.
  function elementIsInViewport(el) {
    try {
      if (!el || typeof el.getBoundingClientRect !== 'function') return false;
      const rect = el.getBoundingClientRect();
      const vw = (window.innerWidth || document.documentElement.clientWidth);
      const vh = (window.innerHeight || document.documentElement.clientHeight);
      // consider it visible if center of element lies within viewport with small margin
      const marginV = Math.min(120, Math.floor(vh * 0.15));
      const marginH = Math.min(80, Math.floor(vw * 0.1));
      const topVisible = rect.top >= 0 - marginV && rect.top <= vh + marginV;
      const bottomVisible = rect.bottom >= 0 - marginV && rect.bottom <= vh + marginV;
      const leftVisible = rect.left >= 0 - marginH && rect.left <= vw + marginH;
      const rightVisible = rect.right >= 0 - marginH && rect.right <= vw + marginH;
      // If any part is visible and not completely off-screen horizontally, consider visible
      return (topVisible || bottomVisible) && (leftVisible || rightVisible);
    } catch (e) {
      return false;
    }
  }

  function smartScrollIfNeeded(el) {
    try {
      if (!el) return;
      if (elementIsInViewport(el)) return;
      // Smooth scroll minimal to center element
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } catch (e) {
        // fallback
        const rect = el.getBoundingClientRect();
        window.scrollBy({ top: rect.top - (window.innerHeight / 2), behavior: 'smooth' });
      }
    } catch (e) {
      safeWarn('smartScrollIfNeeded error', e);
    }
  }

  // ---------- Helper: create wrapper element for aggregated fragment ----------
  function createHighlightWrapperForFragment(fragment) {
    try {
      const wrapper = document.createElement('span');
      wrapper.setAttribute('data-aura-tts', '1');
      wrapper.className = 'aura-tts-highlight';
      // keep inline styling fallback if CSS not loaded
      wrapper.style.cssText = 'text-decoration: underline; text-decoration-thickness: 3px; text-decoration-color:#4b6cff; text-underline-offset:3px; font-weight:600; background: transparent;';
      wrapper.appendChild(fragment);
      return wrapper;
    } catch (e) {
      safeWarn('createHighlightWrapperForFragment failed', e);
      return null;
    }
  }

  // ---------- Highlight a continuous global range across nodes ----------
  // startGlobal inclusive, endGlobal exclusive
  function highlightGlobalRange(startGlobal, endGlobal) {
    try {
      if (!textNodeMap || textNodeMap.length === 0) buildTextNodeMap(true);
      if (!textNodeMap || textNodeMap.length === 0) return;

      // clamp
      startGlobal = Math.max(0, Math.min(startGlobal, fullText.length - 1));
      endGlobal = Math.max(startGlobal + 1, Math.min(endGlobal, fullText.length));

      // If the same region is already highlighted, skip
      if (lastGlobalIndexHighlighted === startGlobal && currentHighlightWrapper) return;

      // Clear previous highlights
      clearAuraHighlights();

      // Find first map index
      let startIdx = findMapIndexByGlobalIndex(startGlobal);
      if (startIdx === -1) {
        // If not found, find closest entry after
        startIdx = 0;
        while (startIdx < textNodeMap.length && textNodeMap[startIdx].end <= startGlobal) startIdx++;
        if (startIdx >= textNodeMap.length) startIdx = textNodeMap.length - 1;
      }

      let endIdx = findMapIndexByGlobalIndex(endGlobal - 1);
      if (endIdx === -1) {
        // find closest before
        endIdx = textNodeMap.length - 1;
        while (endIdx >= 0 && textNodeMap[endIdx].start > endGlobal) endIdx--;
        if (endIdx < 0) endIdx = 0;
      }

      // Build a DocumentFragment containing highlighted nodes by extracting the relevant slices
      const resultFrag = document.createDocumentFragment();

      for (let i = startIdx; i <= endIdx && i < textNodeMap.length; i++) {
        const entry = textNodeMap[i];
        if (!entry) continue;
        const node = entry.node;
        const nodeTextNorm = entry.text || '';
        // compute overlap between [startGlobal, endGlobal) and [entry.start, entry.end)
        const overlapStart = Math.max(startGlobal, entry.start);
        const overlapEnd = Math.min(endGlobal, entry.end);
        if (overlapStart >= overlapEnd) continue;
        // slice in normalized node text coordinates
        const localStartNorm = overlapStart - entry.start;
        const localEndNorm = overlapEnd - entry.start;
        const snippetNorm = nodeTextNorm.slice(localStartNorm, localEndNorm);

        // locate snippetNorm in the real node.textContent - we try to find a nearby match
        // To be more robust, search for snippet up to a limited window inside real text
        const realText = node.textContent || '';
        let foundInReal = -1;

        // Try to find exact normalized snippet in realText by normalizing realText similarly
        // But normalizing entire realText is expensive; do a direct search for short sample
        // We'll try the snippet as-is first
        foundInReal = realText.indexOf(snippetNorm);

        if (foundInReal === -1) {
          // try trimmed sample (first 30 chars)
          const sample = snippetNorm.slice(0, Math.min(30, snippetNorm.length));
          foundInReal = realText.indexOf(sample);
        }

        if (foundInReal === -1) {
          // as fallback, highlight whole node
          const r = document.createRange();
          r.selectNodeContents(node);
          resultFrag.appendChild(r.extractContents());
          continue;
        }

        const startOffsetInReal = foundInReal;
        const endOffsetInReal = foundInReal + snippetNorm.length;

        // Create a range on this node
        const range = document.createRange();
        try {
          range.setStart(node, startOffsetInReal);
          range.setEnd(node, endOffsetInReal);
          // Extract contents for wrapping
          const extracted = range.extractContents();
          resultFrag.appendChild(extracted);
        } catch (e) {
          // If setting offsets failed (e.g., because node isn't directly addressable), fallback to selecting node content
          try {
            const r2 = document.createRange();
            r2.selectNodeContents(node);
            const ext = r2.extractContents();
            resultFrag.appendChild(ext);
          } catch (ee) {
            // ignore
          }
        }
      }

      // Wrap fragment with highlight wrapper and insert at first affected node position
      // Determine insertion point: prefer to insert at start map entry's node's parent before that node
      let insertBeforeNode = null;
      try {
        const firstEntry = textNodeMap[startIdx];
        if (firstEntry && firstEntry.node && firstEntry.node.parentNode) {
          insertBeforeNode = firstEntry.node;
        }
      } catch (e) {}

      const wrapper = createHighlightWrapperForFragment(resultFrag);
      if (!wrapper) return;

      if (insertBeforeNode && insertBeforeNode.parentNode) {
        // Find a text node or element to insert before: if insertBeforeNode is a text node we replace it partially:
        try {
          const parent = insertBeforeNode.parentNode;
          // Insert wrapper at the position of insertBeforeNode
          parent.insertBefore(wrapper, insertBeforeNode);
        } catch (e) {
          // fallback to append to body
          document.body.appendChild(wrapper);
        }
      } else {
        document.body.appendChild(wrapper);
      }

      currentHighlightWrapper = wrapper;
      lastGlobalIndexHighlighted = startGlobal;

      // Smart scroll: only if wrapper not in viewport
      try { smartScrollIfNeeded(wrapper); } catch (e) {}

    } catch (e) {
      safeWarn('highlightGlobalRange error', e);
    }
  }

  // ---------- Highlight the word at a given global index ----------
  function highlightAtGlobalIndex(globalIndex) {
    try {
      if (!fullText || !textNodeMap || textNodeMap.length === 0) {
        buildTextNodeMap(true);
      }
      // clamp
      globalIndex = Math.max(0, Math.min(globalIndex, fullText.length - 1));

      // Find word boundaries in fullText
      // Expand left until whitespace or start; expand right until whitespace or end
      let left = globalIndex;
      while (left > 0 && !(/\s/.test(fullText[left - 1]))) left--;
      let right = globalIndex;
      while (right < fullText.length && !(/\s/.test(fullText[right]))) right++;
      if (left === right) {
        // Nothing found, attempt to expand one char
        if (right < fullText.length) right++;
        else if (left > 0) left--;
      }

      // Now highlight between left and right (range)
      highlightGlobalRange(left, right);
    } catch (e) {
      safeWarn('highlightAtGlobalIndex error', e);
    }
  }

  // Expose for debugging (optional)
  try {
    window.__aura_debug.highlightAt = function(idx) { highlightAtGlobalIndex(idx); };
    window.__aura_debug.clearHighlights = function() { clearAuraHighlights(); };
  } catch (e) {}

  // End of Part 2
})();
/**
 * content.js — Part 3/4
 * - Message listener integration (AURA_HIGHLIGHT, AURA_HIGHLIGHT_CLEAR, AURA_SCRAPE_SECTIONS, AURA_APPLY_PROFILE, AURA_TOGGLE_PANEL)
 * - On receiving chunk highlight requests, map chunk->global index and call highlighter
 * - Robust handling for missing maps, dynamic rebuilds, and defensive responses
 * - MutationObserver watches DOM and schedules rebuilds (non-blocking)
 */

(() => {
  'use strict';

  // We rely on functions/vars from Parts 1 & 2:
  // - buildTextNodeMap(), findChunkInFullText(), highlightAtGlobalIndex(), clearAuraHighlights(), safeLog/safeWarn

  // Helper: map a chunk's local charIndex to a globalIndex in fullText
  function mapChunkIndexToGlobal(chunkText, chunkCharIndex) {
    try {
      if (!chunkText || typeof chunkCharIndex !== 'number') return -1;
      // ensure map exists and is recent
      if (!fullText || !textNodeMap || textNodeMap.length === 0) buildTextNodeMap(true);

      // Heuristic: try searching near lastMatchPosition first
      let approx = Math.max(0, lastMatchPosition);
      let foundAt = findChunkInFullText(chunkText, approx);

      if (foundAt === -1) {
        // try global find
        foundAt = findChunkInFullText(chunkText, 0);
      }

      if (foundAt === -1) {
        // try shorter first-60-chars as fallback
        const sample = normalizeTextForMap(chunkText).slice(0, 60);
        if (sample && sample.length >= 6) {
          foundAt = fullText.indexOf(sample);
        }
      }

      // If still not found, as last resort attempt to match by progressively smaller windows
      if (foundAt === -1) {
        const norm = normalizeTextForMap(chunkText);
        for (let len = Math.min(80, norm.length); len >= 12 && foundAt === -1; len -= 12) {
          const sub = norm.slice(0, len);
          foundAt = fullText.indexOf(sub);
        }
      }

      if (foundAt === -1) {
        // Give a best-effort fallback: place near lastMatchPosition or start
        foundAt = Math.max(0, Math.min(lastMatchPosition || 0, Math.max(0, fullText.length - 1)));
      } else {
        // Move heuristic pointer a bit earlier to help next searches
        lastMatchPosition = Math.max(0, foundAt - 50);
      }

      const globalIndex = foundAt + Math.max(0, chunkCharIndex);
      return Math.max(0, Math.min(globalIndex, Math.max(0, fullText.length - 1)));
    } catch (e) {
      safeWarn('mapChunkIndexToGlobal failed', e);
      return -1;
    }
  }

  // Message listener
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) {
        try { sendResponse({ ok: false, error: 'no_type' }); } catch (e) {}
        return true;
      }

      // Scrape sections (existing behavior)
      if (msg.type === 'AURA_SCRAPE_SECTIONS') {
        try {
          const sections = (typeof scrapeSections === 'function') ? scrapeSections() : [];
          sendResponse({ sections, url: location.href, title: document.title });
        } catch (e) {
          sendResponse({ sections: [], url: location.href, title: document.title });
        }
        return true;
      }

      // Apply profile (existing behavior)
      if (msg.type === 'AURA_APPLY_PROFILE') {
        try {
          if (typeof applyProfileToDocument === 'function') applyProfileToDocument(msg.profile);
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA_APPLY_PROFILE error', e);
          sendResponse({ ok: false, error: String(e) });
        }
        return true;
      }

      // Toggle panel (existing)
      if (msg.type === 'AURA_TOGGLE_PANEL') {
        try {
          if (typeof auraOpenSidePanel === 'function') auraOpenSidePanel();
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA_TOGGLE_PANEL error', e);
          sendResponse({ ok: false, error: String(e) });
        }
        return true;
      }

      // Clear highlights
      if (msg.type === 'AURA_HIGHLIGHT_CLEAR') {
        try {
          clearAuraHighlights();
          sendResponse({ ok: true });
        } catch (e) {
          safeWarn('AURA_HIGHLIGHT_CLEAR error', e);
          sendResponse({ ok: false, error: String(e) });
        }
        return true;
      }

      // Robust highlight handling for chunk-based TTS:
      // Payload: { type: 'AURA_HIGHLIGHT', index: <charIndex_in_chunk>, text: <chunkText>, chunkStartGlobal?: <optional> }
      if (msg.type === 'AURA_HIGHLIGHT') {
        (async () => {
          try {
            const { index: charIndex, text: chunkText } = msg || {};
            if (!chunkText || typeof charIndex !== 'number') {
              try { sendResponse({ ok: false, error: 'invalid_payload' }); } catch (e) {}
              return;
            }

            // Rebuild map right before mapping to improve accuracy (dynamic pages)
            try { buildTextNodeMap(true); } catch (ee) {}

            const globalIndex = mapChunkIndexToGlobal(chunkText, charIndex);

            if (globalIndex >= 0) {
              highlightAtGlobalIndex(globalIndex);
              try { sendResponse({ ok: true, globalIndex }); } catch (e) {}
            } else {
              // fallback: try direct highlight inside selection or simple highlight near start of doc
              try { clearAuraHighlights(); } catch (e) {}
              try { sendResponse({ ok: false, error: 'map_failed' }); } catch (e) {}
            }
          } catch (e) {
            safeWarn('AURA_HIGHLIGHT worker error', e);
            try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
          }
        })();
        // Return true to indicate we'll call sendResponse asynchronously
        return true;
      }

      // Unknown message
      try { sendResponse({ ok: false, error: 'unknown_message_type' }); } catch (e) {}
      return true;
    } catch (e) {
      safeWarn('onMessage top-level error', e);
      try { sendResponse({ ok: false, error: String(e) }); } catch (ee) {}
      return true;
    }
  });

  // ---------------------------
  // MutationObserver: schedule rebuild of text map when DOM changes significantly
  // Use throttling/debouncing to avoid excessive rebuilds.
  // ---------------------------
  const mutationObserver = new MutationObserver((mutations) => {
    try {
      // Simple heuristic: if there are text changes or added nodes, schedule rebuild
      let shouldRebuild = false;
      for (const m of mutations) {
        if (m.type === 'characterData') {
          shouldRebuild = true;
          break;
        }
        if (m.addedNodes && m.addedNodes.length) {
          shouldRebuild = true;
          break;
        }
        if (m.removedNodes && m.removedNodes.length) {
          shouldRebuild = true;
          break;
        }
        // attribute changes might not require full rebuild
      }

      if (!shouldRebuild) return;

      // Debounce rebuilds to avoid thrash
      if (rebuildTimeout) clearTimeout(rebuildTimeout);
      rebuildTimeout = setTimeout(() => {
        try {
          buildTextNodeMap(true);
        } catch (e) {
          safeWarn('debounced buildTextNodeMap failed', e);
        }
      }, 220); // small delay to batch rapid DOM churn
    } catch (e) {
      safeWarn('mutationObserver handler error', e);
    }
  });

  try {
    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    }
  } catch (e) {
    safeWarn('mutationObserver setup failed', e);
  }

  // ---------------------------
  // Side panel helpers (re-used)
  // ---------------------------
  function auraGetPanelUrl() {
    try { return chrome.runtime.getURL('sidepanel.html'); } catch (e) { return 'sidepanel.html'; }
  }

  let auraPanelHost = null;
  let auraPanelIframe = null;
  function auraOpenSidePanel() {
    try {
      if (document.getElementById(SIDEPANEL_HOST_ID)) {
        const host = document.getElementById(SIDEPANEL_HOST_ID);
        host.style.display = 'flex';
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
            safeLog('AURA: sent profile to side panel');
          }
        } catch (e) { safeWarn('iframe load send error', e); }
      });

      if (!window.__aura_panel_msg_installed) {
        window.addEventListener('message', (e) => {
          try { if (e?.data?.AURA_PANEL_CLOSE) auraCloseSidePanel(); } catch (er) {}
        }, { passive: true });
        window.__aura_panel_msg_installed = true;
      }
    } catch (e) {
      safeWarn('auraOpenSidePanel error', e);
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

  // getCurrentProfileForPanel used elsewhere
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

  // End of Part 3
})();
/**
 * content.js — Part 4/4
 * - Selection popup (Simplify / Translate) — unchanged logic, only attached properly
 * - Final initialization (apply profile, handle enable/disable, initial map)
 * - End of full content.js bundle
 */

(() => {
  'use strict';

  // ---------------------------
  // INIT: Apply profile, enable state, build map initially
  // ---------------------------
  function initAura() {
    try {
      // Load initial profile & enabled setting
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
          try {
            const enabled = (res.aura_enabled !== false);
            isEnabled = enabled;
            if (enabled && res && res.aura_profile) {
              currentProfile = res.aura_profile;
              if (typeof applyProfileToDocument === 'function') {
                applyProfileToDocument(currentProfile);
              }
            } else if (!enabled) {
              // disabled => remove global styles
              removeInjectedStyles();
            }
          } catch (e) {
            safeWarn('initAura storage.get error', e);
          }
        });

        // Listen for changes
        chrome.storage.onChanged.addListener((changes, area) => {
          try {
            if (area === 'sync' && changes.aura_profile) {
              currentProfile = changes.aura_profile.newValue;
              if (isEnabled && typeof applyProfileToDocument === 'function') {
                applyProfileToDocument(currentProfile);
              }
            }
            if (area === 'sync' && changes.aura_enabled) {
              isEnabled = (changes.aura_enabled.newValue !== false);
              if (!isEnabled) {
                removeInjectedStyles();
              } else if (currentProfile) {
                if (typeof applyProfileToDocument === 'function') {
                  applyProfileToDocument(currentProfile);
                }
              } else {
                chrome.storage.sync.get(['aura_profile'], (res2) => {
                  if (res2 && res2.aura_profile) {
                    currentProfile = res2.aura_profile;
                    if (typeof applyProfileToDocument === 'function')
                      applyProfileToDocument(currentProfile);
                  }
                });
              }
            }
          } catch (e) {
            safeWarn('initAura storage.onChanged error', e);
          }
        });
      } else {
        // fallback to localStorage
        try {
          const raw = localStorage.getItem('aura_profile');
          if (raw) {
            currentProfile = JSON.parse(raw);
            if (typeof applyProfileToDocument === 'function') {
              applyProfileToDocument(currentProfile);
            }
          }
          const en = localStorage.getItem('aura_enabled');
          isEnabled = en === null ? true : en !== 'false';
          if (!isEnabled) removeInjectedStyles();
        } catch (e) {
          safeWarn('fallback local storage init error', e);
        }
      }

      // Build text map initially
      try { buildTextNodeMap(true); } catch (e) {}

    } catch (e) {
      safeWarn('initAura error', e);
    }
  }

  // Run initAura when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAura);
  } else {
    initAura();
  }

  // ---------------------------
  // OPTIONAL: Live selection popup from original AURA
  // (Simplify / Translate) — mostly unchanged except stable wrappers
  // ---------------------------
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

      // Prevent hide while interacting
      popup.addEventListener('pointerdown', (e) => { window._auraSuppressHide = true; e.stopPropagation(); }, true);
      popup.addEventListener('pointerup', (e) => {
        setTimeout(() => { window._auraSuppressHide = false; }, 150);
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
        let top = preferAbove ? (pageY - popup.offsetHeight - margin) : (pageY + rect.height + margin);
        if (!isFinite(top)) top = window.scrollY + 20;
        popup.style.left = `${Math.round(left)}px`;
        popup.style.top = `${Math.round(top)}px`;
      } catch (e) {}
    }

    function replaceRangeWithText(range, text) {
      try {
        const txt = document.createTextNode(text);
        range.deleteContents();
        range.insertNode(txt);
        const sel = window.getSelection();
        sel.removeAllRanges();
        const newR = document.createRange();
        newR.setStartAfter(txt);
        newR.collapse(true);
        sel.addRange(newR);
      } catch (e) {}
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

    async function callProxyForText({ question, selectionText }) {
      async function doPost(payload) {
        const resp = await fetch('http://127.0.0.1:3000/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`Proxy error ${resp.status}`);
        try {
          return await resp.json();
        } catch (e) {
          const txt = await resp.text();
          return { rawText: txt };
        }
      }

      const basePayload = {
        question,
        sections: [{ heading: 'selection', text: selectionText, anchor: null }],
        pageInfo: { url: location.href, title: document.title }
      };
      return doPost(basePayload);
    }

    async function onSimplifyClick(e) {
      e.stopPropagation();
      const info = getSelectionRange();
      if (!info) return removePopup();
      setPopupLoading(true, 'Simplifying...');
      try {
        const question = `Simplify this text for readability. Return simplified text only.`;
        const out = await callProxyForText({ question, selectionText: info.text });
        const val = out.details || out.tldr || out.rawText || '';
        if (val) replaceRangeWithText(info.range, val);
        setPopupLoading(false, 'Done');
        removePopup();
      } catch (err) {
        setPopupLoading(false, 'Error');
        alert('AURA: Simplify failed.');
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
        const question = `Translate into "${lang}". Return only translated text.`;
        const out = await callProxyForText({ question, selectionText: info.text });
        const val = out.details || out.tldr || out.rawText || '';
        if (val) replaceRangeWithText(info.range, val);
        setPopupLoading(false, 'Done');
        removePopup();
      } catch (err) {
        setPopupLoading(false, 'Error');
        alert('AURA: Translation failed.');
      }
    }

    function showPopupForSelection() {
      try {
        const info = getSelectionRange();
        if (!info) return removePopup();
        const popup = createPopup();
        requestAnimationFrame(() => positionPopup(popup, info.range));
      } catch (e) {}
    }

    function onSelectionChangeTrigger() {
      if (window._auraSuppressHide) return;
      setTimeout(() => {
        const info = getSelectionRange();
        if (info) showPopupForSelection();
        else removePopup();
      }, 10);
    }

    document.addEventListener('mouseup', onSelectionChangeTrigger, true);
    document.addEventListener('keyup', onSelectionChangeTrigger, true);

    document.addEventListener('mousedown', (e) => {
      const popup = document.getElementById(POPUP_ID);
      if (popup && !popup.contains(e.target)) removePopup();
    }, true);

    document.addEventListener('scroll', removePopup, true);

    window.__aura_remove_selection_popup = removePopup;
  })();

  // ---------------------------
  // END OF FULL CONTENT.JS
  // ---------------------------
})();
