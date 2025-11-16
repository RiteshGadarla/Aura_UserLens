// popup.js — Updated with AURA top-toggle + dependent feature locking (Option B)

document.addEventListener('DOMContentLoaded', () => {

  // =====================
  // ELEMENT REFERENCES
  // =====================

  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');

  const toggleApplyBtn = document.getElementById('toggleApply');

  const adblockToggle = document.getElementById('adblockToggle');
  const darkmodeToggle = document.getElementById('darkmodeToggle');
  const focusToggle = document.getElementById('focusToggle');

  const ttsSection = document.getElementById('ttsSection');
  const ttsAccent = document.getElementById('ttsAccent');
  const ttsVoice = document.getElementById('ttsVoice');
  const ttsPitch = document.getElementById('ttsPitch');
  const ttsRate = document.getElementById('ttsRate');

  const speakPageBtn = document.getElementById('speakPageBtn');
  const speakSelectedBtn = document.getElementById('speakSelectedBtn');

  const playControls = document.getElementById('playControls');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const stopBtn = document.getElementById('stopBtn');

  const blockedCountEl = document.getElementById('blockedCount');
  const currentTimeEl = document.getElementById('currentTime');
  const isNightEl = document.getElementById('isNight');

  const auraChildren = document.querySelectorAll(".aura-child");

  const pitchValue = document.getElementById('pitchValue');
  const rateValue = document.getElementById('rateValue');

  let availableVoices = [];
  let utteranceQueue = [];
  let currentChunkIndex = 0;
  let entirePageText = "";


  // =======================================
  // AURA ENABLE / DISABLE (OPTION B LOGIC)
  // =======================================

  function setAuraChildrenActive(isEnabled) {
    auraChildren.forEach(section => {
      if (isEnabled) {
        section.classList.remove("disabled-section");
      } else {
        section.classList.add("disabled-section");
      }

      // disable ONLY controls inside the sections
      const inputs = section.querySelectorAll("input, select, button");

      inputs.forEach(inp => {
        inp.disabled = !isEnabled;
      });
    });
  }


  // ================================
  // LOAD SAVED STATE
  // ================================
  chrome.storage.sync.get(['aura_enabled', 'aura_profile'], (res) => {

    // Load profile
    if (res.aura_profile) {
      currentProfileEl.textContent = `Profile: ${res.aura_profile.name || 'Custom'}`;
    } else {
      currentProfileEl.textContent = 'No profile set';
    }

    // Load AURA enabled state
    const enabled = res.aura_enabled !== false;
    toggleApplyBtn.checked = enabled;

    setAuraChildrenActive(enabled);
  });


  // ================================
  // SAVE AURA TOGGLE
  // ================================
  toggleApplyBtn.addEventListener("change", () => {
    const enabled = toggleApplyBtn.checked;

    chrome.storage.sync.set({ aura_enabled: enabled });

    setAuraChildrenActive(enabled);
  });


  // ================
  // CLOCK + NIGHT
  // ================
  function updateClock() {
    const now = new Date();
    currentTimeEl.textContent = now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const hour = now.getHours();
    const night = hour >= 18 || hour < 6;

    isNightEl.textContent = night ? "Yes" : "No";
    isNightEl.style.color = night ? "#d32f2f" : "#388e3c";
  }
  setInterval(updateClock, 1000);
  updateClock();


  // ======================
  // COMMUNICATION HELPER
  // ======================
  function sendToActiveTab(msg, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, msg, callback);
      }
    });
  }


  // ================
  // AD BLOCKER
  // ================
  chrome.runtime.sendMessage({ type: 'AURA_ADBLOCK_STATUS' }, (resp) => {
    if (resp) {
      adblockToggle.checked = resp.enabled;
      blockedCountEl.textContent = resp.blocked;
    }
  });

  adblockToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'AURA_ADBLOCK_TOGGLE' }, (resp) => {
      adblockToggle.checked = resp.enabled;
    });
  });


  // ================
  // DARK MODE
  // ================
  chrome.runtime.sendMessage({ type: 'AURA_DARKMODE_STATUS' }, (resp) => {
    if (resp) darkmodeToggle.checked = resp.enabled;
  });

  darkmodeToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'AURA_DARKMODE_TOGGLE' }, (resp) => {
      darkmodeToggle.checked = resp.enabled;
    });
  });


  // ================
  // FOCUS MODE
  // ================
  chrome.storage.local.get(['aura_focus'], (data) => {
    const focus = !!data.aura_focus;
    focusToggle.checked = focus;
    sendToActiveTab({ type: 'AURA_SET_FOCUS', enabled: focus });
  });

  focusToggle.addEventListener("change", () => {
    const enabled = focusToggle.checked;
    chrome.storage.local.set({ aura_focus: enabled });
    sendToActiveTab({ type: 'AURA_SET_FOCUS', enabled });
  });


  // ================================
  // OPEN SETUP PAGE
  // ================================
  openSetupBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    sendToActiveTab({ type: 'AURA_TOGGLE_PANEL' });
  });


  // ================================
  // TTS INITIALIZATION
  // ================================

  function refreshVoices() {
    try {
      chrome.tts.getVoices((voices) => {
        availableVoices = voices || [];
        populateVoiceSelect();
      });
    } catch (e) {
      console.warn("Voice load error:", e);
    }
  }

  function populateVoiceSelect() {
    ttsVoice.innerHTML = `<option value="">Auto (best match)</option>`;

    availableVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceName;
      opt.textContent = `${v.voiceName} — ${v.lang}`;
      ttsVoice.appendChild(opt);
    });
  }

  function pickVoice(accent, specificVoice) {
    if (specificVoice) return specificVoice;
    const match = availableVoices.find(v => v.lang.startsWith(accent));
    return match ? match.voiceName : "";
  }

  function splitText(text) {
    const chunks = [];
    const maxLen = 1800;

    while (text.length > 0) {
      if (text.length <= maxLen) {
        chunks.push(text);
        break;
      }

      let cutoff = text.lastIndexOf(".", maxLen);
      if (cutoff === -1) cutoff = text.lastIndexOf(" ", maxLen);
      if (cutoff === -1) cutoff = maxLen;

      chunks.push(text.slice(0, cutoff + 1));
      text = text.slice(cutoff + 1);
    }
    return chunks;
  }

  function speakChunk(chunk) {
    chrome.tts.speak(chunk, {
      voiceName: pickVoice(ttsAccent.value, ttsVoice.value),
      lang: ttsAccent.value,
      pitch: Number(ttsPitch.value),
      rate: Number(ttsRate.value),

      onEvent: (ev) => {
        if (ev.type === "end") {
          currentChunkIndex++;
          if (currentChunkIndex < utteranceQueue.length) {
            speakChunk(utteranceQueue[currentChunkIndex]);
          } else {
            playControls.style.display = "none";
          }
        }
      }
    });
  }

  function speakLongText(text) {
    utteranceQueue = splitText(text);
    currentChunkIndex = 0;

    playControls.style.display = "flex";
    speakChunk(utteranceQueue[0]);
  }


  // ================================
  // SPEAK PAGE
  // ================================
  speakPageBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => document.body.innerText
      }, (res) => {

        const text = res[0].result.trim();
        if (!text) return alert("No readable text found.");

        entirePageText = text;
        speakLongText(text);
      });
    });
  });


  // ================================
  // SPEAK SELECTION
  // ================================
  speakSelectedBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => window.getSelection().toString()
      }, (res) => {

        const text = res[0].result.trim();
        if (!text) return alert("Select some text first.");

        speakLongText(text);
      });
    });
  });


  // ================================
  // TTS CONTROL BUTTONS
  // ================================
  startBtn.addEventListener("click", () => {
    if (entirePageText) speakLongText(entirePageText);
  });

  pauseBtn.addEventListener("click", () => chrome.tts.pause());
  resumeBtn.addEventListener("click", () => chrome.tts.resume());
  stopBtn.addEventListener("click", () => {
    chrome.tts.stop();
    playControls.style.display = "none";
  });


  // ================================
  // PITCH/RATE LABEL SYNC
  // ================================
  pitchValue.textContent = ttsPitch.value;
  ttsPitch.addEventListener("input", () =>
    pitchValue.textContent = ttsPitch.value
  );

  rateValue.textContent = ttsRate.value;
  ttsRate.addEventListener("input", () =>
    rateValue.textContent = ttsRate.value
  );


  refreshVoices();
});
