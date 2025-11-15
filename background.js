// background.js — AURA: Accessibility + Efficient Ad Blocker
const DEFAULT_TIMEOUT_MS = 3500;
const ADBLOCK_RULESET_ID = "adblock_rules";

// -----------------------
// 1. Ad Block State & Stats
// -----------------------
let adBlockEnabled = true;
let adsBlockedCount = 0;

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }

  // Load saved ad block state
  const data = await chrome.storage.local.get(["adBlockEnabled", "adsBlockedCount"]);
  adBlockEnabled = data.adBlockEnabled !== false; // default: true
  adsBlockedCount = data.adsBlockedCount || 0;

  // Apply ad block state
  updateAdBlockRuleset(adBlockEnabled);

  // Context menu
  chrome.contextMenus.create({
    id: "aura-toggle-panel",
    title: "AURA: Open side panel",
    contexts: ["all"]
  });
});

// Apply ad block ruleset enable/disable
function updateAdBlockRuleset(enabled) {
  const method = enabled ? "enableRulesetIds" : "disableRulesetIds";
  chrome.declarativeNetRequest.updateEnabledRulesets({
    [method]: [ADBLOCK_RULESET_ID]
  }).catch(err => console.warn("AURA: Failed to update ad block ruleset", err));
}

// Track blocked requests
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  if (info.request?.tabId && info.rule?.rulesetId === ADBLOCK_RULESET_ID) {
    adsBlockedCount++;
    chrome.storage.local.set({ adsBlockedCount });
  }
});

// -----------------------
// 2. Context Menu Handler
// -----------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "aura-toggle-panel" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'AURA_TOGGLE_PANEL' }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('AURA background: toggle sendMessage error:', chrome.runtime.lastError.message);
      } else {
        console.log('AURA background: panel toggle acknowledged');
      }
    });
  }
});

// -----------------------
// 3. Helper: Get Active Tab
// -----------------------
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

// -----------------------
// 4. Text Processing & Chunk Scoring
// -----------------------
function norm(str) { return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' '); }
function tokenize(str) { return norm(str).split(/\s+/).filter(Boolean); }

function scoreChunk(q, chunk) {
  const qTokens = tokenize(q);
  const text = (chunk.text || '').toLowerCase();
  const head = (chunk.heading || '').toLowerCase();

  let tf = 0;
  let headHits = 0;
  for (const t of qTokens) {
    const re = new RegExp(`\\b${t}\\b`, 'g');
    tf += (text.match(re) || []).length;
    headHits += (head.match(re) || []).length * 2;
  }
  const lenPenalty = Math.log10(Math.max(200, text.length || 0));
  return (tf + headHits) / (lenPenalty || 1);
}

function pickTopChunks(question, sections, k = 2) {
  const scored = (sections || []).map(s => ({ s, score: scoreChunk(question, s) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(x => x.s);
}

// -----------------------
// 5. LLM Query (via local proxy)
// -----------------------
async function askLLM({ question, contextBlocks, pageInfo }) {
  try {
    const resp = await fetch('http://localhost:3000/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        sections: contextBlocks,
        pageInfo
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.warn('askLLM proxy error', resp.status, txt);
      return { tldr: 'Error', bullets: ['LLM proxy error'], details: txt };
    }

    const data = await resp.json();
    return {
      tldr: data.tldr || '',
      bullets: data.bullets || [],
      details: data.details || '',
      citations: data.citations || []
    };
  } catch (e) {
    console.error('askLLM fetch failed', e);
    return { tldr: 'Error', bullets: [String(e)], details: '' };
  }
}

// -----------------------
// 6. Safe Tab Communication with Timeout
// -----------------------
function askTabForSections(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ error: 'timeout', sections: [], url: '', title: '' });
      }
    }, DEFAULT_TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tabId, { type: 'AURA_SCRAPE_SECTIONS' }, (resp) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message, sections: [], url: '', title: '' });
        } else {
          resolve({
            sections: resp?.sections || [],
            url: resp?.url || '',
            title: resp?.title || ''
          });
        }
      });
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ error: String(e), sections: [], url: '', title: '' });
      }
    }
  });
}

// -----------------------
// 7. Message Handler (Main Entry)
// -----------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // --- Ad Block Controls ---
      if (msg.type === 'AURA_ADBLOCK_TOGGLE') {
        adBlockEnabled = !adBlockEnabled;
        updateAdBlockRuleset(adBlockEnabled);
        await chrome.storage.local.set({ adBlockEnabled });
        sendResponse({ enabled: adBlockEnabled });
        return;
      }

      if (msg.type === 'AURA_ADBLOCK_STATUS') {
        sendResponse({ enabled: adBlockEnabled, blocked: adsBlockedCount });
        return;
      }

      // --- LLM Panel Query ---
      if (msg.type === 'AURA_PANEL_ASK') {
        const tabId = sender.tab?.id || await getActiveTabId();
        if (!tabId) {
          sendResponse({ tldr: 'Error', bullets: ['No active tab'], details: '' });
          return;
        }

        const tabResp = await askTabForSections(tabId);
        if (tabResp.error) {
          sendResponse({ tldr: 'Error', bullets: [tabResp.error], details: '' });
          return;
        }

        const topChunks = pickTopChunks(msg.question, tabResp.sections, 2);
        const llmResp = await askLLM({
          question: msg.question,
          contextBlocks: topChunks,
          pageInfo: { url: tabResp.url, title: tabResp.title }
        });

        sendResponse({
          ...llmResp,
          pageUrl: tabResp.url
        });
        return;
      }

      // --- Scrape Sections from Tab ---
      if (msg.type === 'AURA_SCRAPE_FROM_TAB') {
        const tabId = sender.tab?.id || await getActiveTabId();
        if (!tabId) {
          sendResponse({ sections: [], url: '', title: '' });
          return;
        }
        const tabResp = await askTabForSections(tabId);
        sendResponse({
          sections: tabResp.sections || [],
          url: tabResp.url || '',
          title: tabResp.title || ''
        });
        return;
      }

      // --- Pick Top Chunks (client-side) ---
      if (msg.type === 'AURA_PICK_CHUNKS') {
        const top = pickTopChunks(msg.question, msg.sections, 2);
        sendResponse(top);
        return;
      }

      // --- Text-to-Speech ---
      if (msg.type === 'AURA_TTS') {
        try {
          chrome.tts.speak(msg.text || "", {
            enqueue: false,
            rate: 1.0,
            pitch: 1.0
          });
        } catch (e) {
          console.warn('AURA TTS error:', e);
        }
        return;
      }

    } catch (e) {
      console.error('AURA background: unexpected error', e);
      try { sendResponse({ tldr: 'Error', bullets: [String(e)], details: '' }); } catch {}
    }
  })();

  return true; // Keep message channel open for async
});