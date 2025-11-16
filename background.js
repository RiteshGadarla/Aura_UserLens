// background.js — AURA: Full Features + Ad Block + Auto Night Dark Mode + TTS
const DEFAULT_TIMEOUT_MS = 3500;
const ADBLOCK_RULESET_ID = "adblock_rules";

// -----------------------
// 1. State Variables
// -----------------------
let adBlockEnabled = true;
let adsBlockedCount = 0;
let darkModeEnabled = true;
let isNightTime = false;

// -----------------------
// 2. Night Detection (6 PM – 6 AM)
// -----------------------
function updateNightStatus() {
  const now = new Date();
  const hour = now.getHours();
  const prevNight = isNightTime;
  isNightTime = hour >= 18 || hour < 6;

  if (prevNight !== isNightTime) {
    applyDarkModeToAllTabs();
  }
}

// -----------------------
// 3. Dark Mode CSS
// -----------------------
const DARK_MODE_CSS = `
  html, body, div, span, applet, object, iframe,
  h1, h2, h3, h4, h5, h6, p, blockquote, pre,
  a, abbr, acronym, address, big, cite, code,
  del, dfn, em, img, ins, kbd, q, s, samp,
  small, strike, strong, sub, sup, tt, var,
  b, u, i, center, dl, dt, dd, ol, ul, li,
  fieldset, form, label, legend,
  table, caption, tbody, tfoot, thead, tr, th, td,
  article, aside, canvas, details, embed,
  figure, figcaption, footer, header, hgroup,
  menu, nav, output, ruby, section, summary,
  time, mark, audio, video {
    background-color: #1a1a1a !important;
    color: #e0e0e0 !important;
    border-color: #444 !important;
  }
  a { color: #82aaff !important; }
  a:visited { color: #c792ea !important; }
  input, textarea, select {
    background-color: #2d2d2d !important;
    color: #e0e0e0 !important;
    border: 1px solid #555 !important;
  }
  img, video, iframe { filter: brightness(0.9) contrast(1.1); }
  * { scrollbar-color: #555 #2d2d2d; }
`;

// Inject/Remove CSS
async function toggleDarkModeOnTab(tabId, enable) {
  try {
    if (enable) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: DARK_MODE_CSS
      });
    } else {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: DARK_MODE_CSS
      });
    }
  } catch (err) {
    console.warn("AURA: Dark mode failed on tab", tabId, err);
  }
}

// Apply to all tabs
async function applyDarkModeToAllTabs() {
  const shouldEnable = darkModeEnabled && isNightTime;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && !tab.url?.startsWith('chrome://')) {
      await toggleDarkModeOnTab(tab.id, shouldEnable);
    }
  }
}

// -----------------------
// 4. onInstalled
// -----------------------
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }

  // Load saved state
  const data = await chrome.storage.local.get([
    "adBlockEnabled",
    "adsBlockedCount",
    "darkModeEnabled"
  ]);
  adBlockEnabled = data.adBlockEnabled !== false;
  adsBlockedCount = data.adsBlockedCount || 0;
  darkModeEnabled = data.darkModeEnabled !== false;

  // Apply ad block
  updateAdBlockRuleset(adBlockEnabled);

  // Context menu
  chrome.contextMenus.create({
    id: "aura-toggle-panel",
    title: "AURA: Open side panel",
    contexts: ["all"]
  });

  // Start night detection
  updateNightStatus();
  setInterval(updateNightStatus, 60_000); // every minute
});

// -----------------------
// 5. Ad Block Functions
// -----------------------
function updateAdBlockRuleset(enabled) {
  const method = enabled ? "enableRulesetIds" : "disableRulesetIds";
  chrome.declarativeNetRequest.updateEnabledRulesets({
    [method]: [ADBLOCK_RULESET_ID]
  }).catch(err => console.warn("AURA: Ad block toggle failed", err));
}

// Count blocked ads
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  if (info.request?.tabId && info.rule?.rulesetId === ADBLOCK_RULESET_ID) {
    adsBlockedCount++;
    chrome.storage.local.set({ adsBlockedCount });
  }
});

// -----------------------
// 6. Context Menu
// -----------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "aura-toggle-panel" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'AURA_TOGGLE_PANEL' });
  }
});

// -----------------------
// 7. Tab Updates: Re-apply dark mode
// -----------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    if (darkModeEnabled && isNightTime) {
      toggleDarkModeOnTab(tabId, true);
    }
  }
});

// -----------------------
// 8. Helper: Get Active Tab
// -----------------------
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

// -----------------------
// 9. Text Processing & Chunk Scoring
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
// 10. LLM Query
// -----------------------
async function askLLM({ question, contextBlocks, pageInfo }) {
  try {
    const resp = await fetch('http://localhost:3000/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, sections: contextBlocks, pageInfo })
    });
    if (!resp.ok) {
      const txt = await resp.text();
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
    return { tldr: 'Error', bullets: [String(e)], details: '' };
  }
}

// -----------------------
// 11. Tab Communication
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
// 12. Message Handler (Main Entry)
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

      // --- Dark Mode Controls ---
      if (msg.type === 'AURA_DARKMODE_TOGGLE') {
        darkModeEnabled = !darkModeEnabled;
        await chrome.storage.local.set({ darkModeEnabled });
        await applyDarkModeToAllTabs();
        sendResponse({ enabled: darkModeEnabled });
        return;
      }
      if (msg.type === 'AURA_DARKMODE_STATUS') {
        sendResponse({ enabled: darkModeEnabled, isNight: isNightTime });
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
        sendResponse({ ...llmResp, pageUrl: tabResp.url });
        return;
      }

      // --- Scrape Sections ---
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

      // --- Pick Top Chunks ---
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
            rate: msg.rate || 1.0,
            pitch: msg.pitch || 1.0,
            voiceName: msg.voiceName || '',
            lang: msg.lang || ''
          });
        } catch (e) {
          console.warn('AURA TTS error:', e);
        }
        return;
      }

    } catch (e) {
      console.error('AURA background error:', e);
      try { sendResponse({ tldr: 'Error', bullets: [String(e)], details: '' }); } catch {}
    }
  })();

  return true; // async response
});
chrome.commands.onCommand.addListener(async (command) => {
  console.log("Shortcut pressed:", command);

  // 1️⃣ Toggle Night Mode
  if (command === "toggle_night_mode") {
    darkModeEnabled = !darkModeEnabled;
    chrome.storage.local.set({ darkModeEnabled });
    applyDarkModeToAllTabs();
    return;
  }

  // 2️⃣ Open Setup Page
  if (command === "open_setup_page") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
    return;
  }

  // 3️⃣ Toggle AURA (Enable/Disable Profiles)
  if (command === "toggle_aura") {
    const newValue = !(await chrome.storage.sync.get("aura_enabled")).aura_enabled;
    chrome.storage.sync.set({ aura_enabled: newValue });

    // Notify content scripts on all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && !tab.url.startsWith("chrome://")) {
        chrome.tabs.sendMessage(tab.id, {
          type: "AURA_TOGGLE_FROM_SHORTCUT",
          enabled: newValue
        });
      }
    }

    console.log("AURA enabled:", newValue);
    return;
  }

  // 4️⃣ Open Sidepanel
  if (command === "open_sidepanel") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "AURA_TOGGLE_PANEL_KEY" });
    }
    return;
  }
});