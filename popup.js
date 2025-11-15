// popup.js (UPDATED WITH CHUNKING SUPPORT)

document.addEventListener('DOMContentLoaded', () => {
  const currentProfileEl = document.getElementById('currentProfile');
  const openSetupBtn = document.getElementById('openSetup');
  const toggleApplyBtn = document.getElementById('toggleApply');
  const ttsSection = document.getElementById('ttsSection');

  const ttsAccent = document.getElementById('ttsAccent');
  const ttsVoice = document.getElementById('ttsVoice');
  const ttsPitch = document.getElementById('ttsPitch');
  const ttsRate = document.getElementById('ttsRate');
  const pitchValue = document.getElementById('pitchValue');
  const rateValue = document.getElementById('rateValue');
  const ttsHighlight = document.getElementById('ttsHighlight');
  const ttsWord = document.getElementById('ttsWord');

  const speakPageBtn = document.getElementById('speakPageBtn');
  const speakSelectedBtn = document.getElementById('speakSelectedBtn');

  const playControls = document.getElementById('playControls');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const stopBtn = document.getElementById('stopBtn');

  const voiceStatus = document.getElementById('voiceStatus');

  let availableVoices = [];
  let utteranceQueue = [];
  let currentChunkIndex = 0;
  let entirePageText = "";
  let isPaused = false;
  let isSpeakingWholePage = false;

  // -----------------------------
  //  LOAD PROFILE
  // -----------------------------
  function loadProfile() {
    chrome.storage.sync.get(['aura_profile', 'aura_enabled'], (res) => {
      currentProfileEl.textContent = res && res.aura_profile
        ? `Profile: ${res.aura_profile.name}`
        : 'No profile set';

      const enabled = res.aura_enabled !== false;
      toggleApplyBtn.checked = enabled;
      ttsSection.style.display = enabled ? 'block' : 'none';
    });
  }

  // -----------------------------
  //  LOAD TTS VOICES
  // -----------------------------
  function refreshVoices() {
    try {
      chrome.tts.getVoices((voices) => {
        availableVoices = voices || [];
        populateVoiceSelect();
      });
    } catch (e) {
      console.warn("refreshVoices error", e);
    }
  }

  function populateVoiceSelect() {
    ttsVoice.innerHTML = `<option value="">Auto (best match)</option>`;
    availableVoices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceName;
      opt.textContent = `${v.voiceName} — ${v.lang}`;
      ttsVoice.appendChild(opt);
    });
  }

  function pickVoice(accent, specificVoice) {
    if (specificVoice) return specificVoice;
    const voice = availableVoices.find(v => v.lang.startsWith(accent));
    return voice ? voice.voiceName : "";
  }

  // -----------------------------
  //  HIGHLIGHTING
  // -----------------------------
  function sendHighlight(index, text) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "AURA_HIGHLIGHT",
        index,
        text
      });
    });
  }

  function clearHighlights() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "AURA_HIGHLIGHT_CLEAR" });
    });
  }

  // -----------------------------
  //  TEXT CHUNKING FOR LONG TTS
  // -----------------------------
  function splitIntoChunks(text) {
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

  // -----------------------------
  //  SPEAK A SINGLE CHUNK
  // -----------------------------
  function speakChunk(chunkText) {
    const accent = ttsAccent.value;
    const voice = pickVoice(accent, ttsVoice.value);
    const pitch = Number(ttsPitch.value);
    const rate = Number(ttsRate.value);
    const highlightEnabled = ttsHighlight.checked;

    chrome.tts.speak(chunkText, {
      voiceName: voice,
      lang: accent,
      pitch,
      rate,
      onEvent: (event) => {
        if (event.type === "word" && highlightEnabled) {
          sendHighlight(event.charIndex, chunkText);
        }

        if (event.type === "end") {
          currentChunkIndex++;
          if (currentChunkIndex < utteranceQueue.length) {
            speakChunk(utteranceQueue[currentChunkIndex]);
          } else {
            clearHighlights();
          }
        }
      }
    }, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn("speak error:", err.message);
    });
  }

  // -----------------------------
  //  SPEAK TEXT (MULTI-CHUNK)
  // -----------------------------
  function speakLongText(text) {
    clearHighlights();
    const specific = ttsWord.value.trim();
    const finalText = specific.length ? specific : text;

    utteranceQueue = splitIntoChunks(finalText);
    currentChunkIndex = 0;

    playControls.style.display = "flex";

    speakChunk(utteranceQueue[0]);
  }

  // -----------------------------
  //  BUTTON: SPEAK ENTIRE PAGE
  // -----------------------------
  speakPageBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => document.body.innerText
      }, (res) => {
        const text = res[0].result.trim();
        if (!text.length) {
          alert("No readable text found.");
          return;
        }
        entirePageText = text;
        isSpeakingWholePage = true;
        speakLongText(text);
      });
    });
  });

  // -----------------------------
  //  BUTTON: SPEAK SELECTED
  // -----------------------------
  speakSelectedBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => window.getSelection().toString()
      }, (res) => {
        const text = res[0].result.trim();
        if (!text) {
          alert("Select some text first.");
          return;
        }
        isSpeakingWholePage = false;
        speakLongText(text);
      });
    });
  });

  // -----------------------------
  //  PLAYBACK CONTROLS
  // -----------------------------
  startBtn.addEventListener("click", () => {
    if (entirePageText) speakLongText(entirePageText);
  });

  pauseBtn.addEventListener("click", () => chrome.tts.pause());
  resumeBtn.addEventListener("click", () => chrome.tts.resume());
  stopBtn.addEventListener("click", () => {
    chrome.tts.stop();
    clearHighlights();
    playControls.style.display = "none";
  });

  // -----------------------------
  //  OTHER UI
  // -----------------------------
  pitchValue.textContent = ttsPitch.value;
  ttsPitch.addEventListener("input", () => pitchValue.textContent = ttsPitch.value);

  rateValue.textContent = ttsRate.value;
  ttsRate.addEventListener("input", () => rateValue.textContent = ttsRate.value);

  toggleApplyBtn.addEventListener("change", () =>
    chrome.storage.sync.set({ aura_enabled: toggleApplyBtn.checked })
  );

  openSetupBtn.addEventListener("click", () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") })
  );

  loadProfile();
  refreshVoices();
});
