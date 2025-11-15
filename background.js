// background.js (further hardened)
const DEFAULT_TIMEOUT_MS = 3500; // if tab doesn't respond in time, bail

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
  chrome.contextMenus.create({
    id: "aura-toggle-panel",
    title: "AURA: Open side panel",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "aura-toggle-panel" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'AURA_TOGGLE_PANEL' }, (resp) => {
      if (chrome.runtime.lastError) {
        // The content script might not be injected on this page (or blocked).
        console.warn('AURA background: toggle sendMessage lastError:', chrome.runtime.lastError.message);
      } else {
        console.log('AURA background: toggle acknowledged');
      }
    });
  }
});

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

function norm(str){ return (str||'').toLowerCase().replace(/[^a-z0-9\s]/g,' '); }
function tokenize(str){ return norm(str).split(/\s+/).filter(Boolean); }
function scoreChunk(q, chunk){
  const qTokens = tokenize(q);
  const text = (chunk.text||'').toLowerCase();
  const head = (chunk.heading||'').toLowerCase();

  let tf = 0;
  let headHits = 0;
  for (const t of qTokens){
    const re = new RegExp(`\\b${t}\\b`,'g');
    tf += (text.match(re)||[]).length;
    headHits += (head.match(re)||[]).length * 2;
  }
  const lenPenalty = Math.log10(Math.max(200, text.length || 0));
  return (tf + headHits) / (lenPenalty || 1);
}
function pickTopChunks(question, sections, k=2){
  const scored = (sections||[]).map(s => ({ s, score: scoreChunk(question, s) }));
  scored.sort((a,b)=> b.score - a.score);
  return scored.slice(0,k).map(x => x.s);
}

async function askLLM({question, contextBlocks, pageInfo}) {
  try {
    // keep payload compact — you already trimmed each section text to 8000 chars earlier
    const resp = await fetch('http://localhost:3000/ask', { // replace with your deployed server URL
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
      return { tldr: 'Error', bullets: [ 'LLM proxy error' ], details: txt };
    }
    const data = await resp.json();
    // ensure shape
    return {
      tldr: data.tldr || '',
      bullets: data.bullets || [],
      details: data.details || '',
      citations: data.citations || []
    };
  } catch (e) {
    console.error('askLLM fetch failed', e);
    return { tldr: 'Error', bullets: [ String(e) ], details: '' };
  }
}


// helper: ask tab for sections with timeout and lastError handling
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
      chrome.tabs.sendMessage(tabId, { type:'AURA_SCRAPE_SECTIONS' }, (resp) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message, sections: [], url: '', title: '' });
        } else {
          resolve({ sections: resp?.sections || [], url: resp?.url || '', title: resp?.title || '' });
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'AURA_PANEL_ASK') {
        // keep channel open
        const tabId = sender.tab?.id || await getActiveTabId();
        if (!tabId) {
          sendResponse({ tldr:'Error', bullets:['No active tab found'], details:'' });
          return;
        }

        // Ask tab for sections (with timeout)
        const tabResp = await askTabForSections(tabId);
        if (tabResp.error) {
          console.warn('AURA background: askTabForSections error:', tabResp.error);
          sendResponse({ tldr:'Error', bullets:[tabResp.error], details:'' });
          return;
        }

        try {
          const top = pickTopChunks(msg.question, tabResp.sections, 2);
          const data = await askLLM({
            question: msg.question,
            contextBlocks: top,
            pageInfo: { url: tabResp.url || '', title: tabResp.title || '' }
          });
          // FIX: Add pageUrl to the response so sidePanel.js can construct citation links
          sendResponse({
            ...data,
            pageUrl: tabResp.url || ''
          });
          return;
        } catch (e) {
          console.error('AURA_PANEL_ASK LLM error', e);
          sendResponse({ tldr:'Error', bullets:[String(e)], details:'' });
          return;
        }
      }

      if (msg.type === 'AURA_SCRAPE_FROM_TAB') {
        const tabId = sender.tab?.id || await getActiveTabId();
        if (!tabId) {
          sendResponse({ sections: [], url: '', title: '' });
          return;
        }
        const tabResp = await askTabForSections(tabId);
        sendResponse({ sections: tabResp.sections || [], url: tabResp.url || '', title: tabResp.title || '' });
        return;
      }

      if (msg.type === 'AURA_PICK_CHUNKS') {
        const top = pickTopChunks(msg.question, msg.sections, 2);
        sendResponse(top);
        return;
      }

      if (msg.type === 'AURA_TTS') {
        try {
          chrome.tts.speak(msg.text || "", { enqueue: false, rate: 1.0, pitch: 1.0 });
        } catch (e) {
          console.warn('AURA background: tts error', e);
        }
        // no response needed
        return;
      }
    } catch (e) {
      console.error('AURA background: unexpected handler error', e);
      try { sendResponse({ tldr:'Error', bullets:[String(e)], details:'' }); } catch {}
    }
  })();
  return true; // important for async sendResponse
});