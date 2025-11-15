// Profiles with default settings (now with linkColor)
const profiles = [
  { id: 'none', name: 'None (Default)', fontSize: 16, fontFamily: "'Arial', sans-serif", bgColor: "#ffffff", textColor: "#000000", linkColor: "#1a0dab", lineHeight: 1.4, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto'},
  { id: 'dyslexia', name: 'Dyslexia', fontSize: 20, fontFamily: "'OpenDyslexic','Verdana', 'Arial', sans-serif", bgColor: "#fffbe6", textColor: "#0b1b3a", linkColor: "#165788", lineHeight: 1.6, letterSpacing: 0.18, wordSpacing: 0.28, animations: false, cursorType: 'text' },
  { id: 'adhd', name: 'ADHD', fontSize: 18, fontFamily: "'Open Sans', sans-serif", bgColor: "#ffffff", textColor: "#111111", linkColor: "#0066cc", lineHeight: 1.4, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' },
  { id: 'autism', name: 'Autism', fontSize: 19, fontFamily: "'Arial', sans-serif", bgColor: "#f6fbff", textColor: "#0b2a4a", linkColor: "#0b5fff", lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' },
  { id: 'lowvision', name: 'Low Vision', fontSize: 26, fontFamily: "'Verdana', sans-serif", bgColor: "#000000", textColor: "#ffffff", linkColor: "#66b3ff", lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' },
  { id: 'colorblind', name: 'Color Blindness', fontSize: 18, fontFamily: "'Arial', sans-serif", bgColor: "#ffffff", textColor: "#000000", linkColor: "#2b6cb0", lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' },
  { id: 'fatigue', name: 'Cognitive Fatigue', fontSize: 18, fontFamily: "'Roboto', sans-serif", bgColor: "#f4f7f6", textColor: "#1b2b2b", linkColor: "#2b6cb0", lineHeight: 1.8, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' },
  { id: 'epilepsy', name: 'Epilepsy Sensitivity', fontSize: 18, fontFamily: "'Arial', sans-serif", bgColor: "#ffffff", textColor: "#000000", linkColor: "#1a0dab", lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, animations: false, cursorType: 'auto' },
  { id: 'motor', name: 'Motor Coordination', fontSize: 18, fontFamily: "'Arial', sans-serif", bgColor: "#fffef6", textColor: "#0b1b3a", linkColor: "#1a73e8", lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, animations: true, cursorType: 'auto' }
];

const profilesGrid = document.getElementById('profilesGrid');
const previewText = document.getElementById('previewText');
const previewBox = document.getElementById('previewBox');
const previewLink = document.getElementById('previewLink');
const saveBtn = document.getElementById('saveBtn');
const openCustom = document.getElementById('openCustom');
const customPanel = document.getElementById('customPanel');
const resetCustom = document.getElementById('resetCustom');
const exportCustom = document.getElementById('exportCustom');
const importCustom = document.getElementById('importCustom');
const importFileInput = document.getElementById('importFileInput');

const fontFamilyEl = document.getElementById('fontFamily');
const fontSizeEl = document.getElementById('fontSize');
const fontSizeVal = document.getElementById('fontSizeVal');
const letterSpacingEl = document.getElementById('letterSpacing');
const letterSpacingVal = document.getElementById('letterSpacingVal');
const wordSpacingEl = document.getElementById('wordSpacing');
const wordSpacingVal = document.getElementById('wordSpacingVal');
const lineHeightEl = document.getElementById('lineHeight');
const lineHeightVal = document.getElementById('lineHeightVal');
const bgColorEl = document.getElementById('bgColor');
const textColorEl = document.getElementById('textColor');
const linkColorEl = document.getElementById('linkColor'); // NEW
const cursorTypeEl = document.getElementById('cursorType');
const animationsCheckbox = document.getElementById('animationsCheckbox');
const saveCustom = document.getElementById('saveCustom');
const animationBox = document.getElementById('animationBox');
const animationShowcase = document.getElementById('animationShowcase');

let currentSelection = null;
let customSettings = {};

// Default profile
const defaultProfile = profiles[0];

// Render profile cards
function renderProfiles() {
  profilesGrid.innerHTML = '';
  profiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `card-${p.id}`;
    card.innerHTML = `<h3>${p.name}</h3><div class="meta">Default view</div>`;
    card.addEventListener('click', () => selectProfile(p));
    profilesGrid.appendChild(card);
  });
}

// Apply settings to preview (now handles link color by setting CSS var)
function applyToPreview(settings) {
  previewBox.style.backgroundColor = settings.bgColor;
  previewText.style.color = settings.textColor;
  previewText.style.fontFamily = settings.fontFamily;
  previewText.style.fontSize = settings.fontSize + 'px';
  previewText.style.lineHeight = settings.lineHeight;
  previewText.style.letterSpacing = settings.letterSpacing + 'px';
  previewText.style.wordSpacing = settings.wordSpacing + 'px';
  previewBox.style.cursor = settings.cursorType || 'auto';

  // Set link color via CSS variable used in setup.css (#previewBox a { color: var(--aura-link-color); })
  const linkColor = settings.linkColor || '#1a0dab';
  previewBox.style.setProperty('--aura-link-color', linkColor);

  // animations
  if (settings.animations === false) {
    previewBox.classList.add('no-animations');
    previewText.classList.add('no-animations');
    animationBox.classList.add('no-animations');
    animationShowcase.classList.add('hidden-showcase');
  } else {
    previewBox.classList.remove('no-animations');
    previewText.classList.remove('no-animations');
    animationBox.classList.remove('no-animations');
    animationShowcase.classList.remove('hidden-showcase');
  }
}

// Select profile
function selectProfile(profile) {
  currentSelection = profile;
  document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`card-${profile.id}`);
  if (card) card.classList.add('selected');
  applyToPreview(profile);
  updateCustomPanel(profile);
  updateProfileDisplay(profile);
}

// Update profile name in preview
function updateProfileDisplay(profile) {
  const profileDisplay = document.getElementById('profileDisplay');
  if (profileDisplay) {
    profileDisplay.textContent = `Profile: ${profile.name || 'Custom'}`;
  }
}

// Sync custom panel with current profile (includes linkColor)
function updateCustomPanel(profile) {
  fontFamilyEl.value = profile.fontFamily;
  fontSizeEl.value = profile.fontSize;
  fontSizeVal.textContent = profile.fontSize;
  letterSpacingEl.value = profile.letterSpacing || 0;
  letterSpacingVal.textContent = (profile.letterSpacing || 0).toFixed(1);
  wordSpacingEl.value = profile.wordSpacing || 0;
  wordSpacingVal.textContent = (profile.wordSpacing || 0).toFixed(1);
  lineHeightEl.value = profile.lineHeight;
  lineHeightVal.textContent = profile.lineHeight;
  bgColorEl.value = profile.bgColor;
  textColorEl.value = profile.textColor;
  linkColorEl.value = profile.linkColor || '#1a0dab';
  cursorTypeEl.value = profile.cursorType || 'auto';
  animationsCheckbox.checked = profile.animations !== false;
}

// Toggle custom panel
openCustom.addEventListener('click', () => {
  customPanel.classList.toggle('hidden');
});

// Live update from custom panel
function updateCustomPreview() {
  const settings = {
    id: 'custom',
    name: 'Custom',
    fontSize: parseInt(fontSizeEl.value, 10),
    fontFamily: fontFamilyEl.value,
    bgColor: bgColorEl.value,
    textColor: textColorEl.value,
    linkColor: linkColorEl.value,
    lineHeight: parseFloat(lineHeightEl.value),
    letterSpacing: parseFloat(letterSpacingEl.value),
    wordSpacing: parseFloat(wordSpacingEl.value),
    cursorType: cursorTypeEl.value,
    animations: animationsCheckbox.checked
  };
  customSettings = settings;
  currentSelection = settings;
  applyToPreview(settings);
  updateProfileDisplay(settings);
}

// Live input listeners (including link color)
fontSizeEl.addEventListener('input', () => {
  fontSizeVal.textContent = fontSizeEl.value;
  updateCustomPreview();
});
letterSpacingEl.addEventListener('input', () => {
  letterSpacingVal.textContent = parseFloat(letterSpacingEl.value).toFixed(1);
  updateCustomPreview();
});
wordSpacingEl.addEventListener('input', () => {
  wordSpacingVal.textContent = parseFloat(wordSpacingEl.value).toFixed(1);
  updateCustomPreview();
});
lineHeightEl.addEventListener('input', () => {
  lineHeightVal.textContent = lineHeightEl.value;
  updateCustomPreview();
});
fontFamilyEl.addEventListener('change', updateCustomPreview);
bgColorEl.addEventListener('input', updateCustomPreview);
textColorEl.addEventListener('input', updateCustomPreview);
linkColorEl.addEventListener('input', updateCustomPreview); // NEW
cursorTypeEl.addEventListener('change', updateCustomPreview);
animationsCheckbox.addEventListener('change', updateCustomPreview);

// === EXPORT PROFILE ===
exportCustom.addEventListener('click', () => {
  updateCustomPreview(); // Sync latest values
  const dataStr = JSON.stringify(customSettings, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aura-profile.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert('Profile exported as aura-profile.json');
});

// === IMPORT PROFILE ===
importCustom.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);

      // Validate required fields (added linkColor)
      const required = ['fontSize', 'fontFamily', 'bgColor', 'textColor', 'linkColor', 'lineHeight', 'letterSpacing', 'wordSpacing', 'cursorType', 'animations'];
      const isValid = required.every(key => key in imported);

      if (!isValid) throw new Error('Invalid profile format');

      // Apply to UI
      fontFamilyEl.value = imported.fontFamily;
      fontSizeEl.value = imported.fontSize;
      fontSizeVal.textContent = imported.fontSize;
      letterSpacingEl.value = imported.letterSpacing;
      letterSpacingVal.textContent = imported.letterSpacing.toFixed(1);
      wordSpacingEl.value = imported.wordSpacing;
      wordSpacingVal.textContent = imported.wordSpacing.toFixed(1);
      lineHeightEl.value = imported.lineHeight;
      lineHeightVal.textContent = imported.lineHeight;
      bgColorEl.value = imported.bgColor;
      textColorEl.value = imported.textColor;
      linkColorEl.value = imported.linkColor || '#1a0dab';
      cursorTypeEl.value = imported.cursorType;
      animationsCheckbox.checked = imported.animations;

      updateCustomPreview();
      alert('Profile imported successfully!');
    } catch (err) {
      alert('Import failed: Invalid or corrupted JSON file.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset file input
});

// === RESET TO DEFAULT ===
resetCustom.addEventListener('click', () => {
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.remove('aura_profile', resetToDefaultProfile);
  } else {
    localStorage.removeItem('aura_profile');
    resetToDefaultProfile();
  }
});

function resetToDefaultProfile() {
  selectProfile(defaultProfile);
  customPanel.classList.add('hidden');
  alert('Settings reset to default (None).');
}

// === SAVE & CONTINUE ===
function persistAndContinue() {
  const toSave = currentSelection || customSettings;
  if (!toSave) {
    alert('Please select or create a profile first.');
    return;
  }

  const prefs = { aura_profile: toSave };

  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set(prefs, () => {
      window.location.href = 'popup.html';
    });
  } else {
    localStorage.setItem('aura_profile', JSON.stringify(toSave));
    window.location.href = 'popup.html';
  }
}

saveBtn.addEventListener('click', persistAndContinue);
saveCustom.addEventListener('click', () => {
  updateCustomPreview();
  persistAndContinue();
});

// === INITIALIZE ===
renderProfiles();
selectProfile(defaultProfile);

// Load saved profile
if (chrome && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get(['aura_profile'], (res) => {
    if (res && res.aura_profile) {
      const saved = res.aura_profile;
      currentSelection = saved;
      applyToPreview(saved);
      updateCustomPanel(saved);
      updateProfileDisplay(saved);
      const match = profiles.find(p => p.id === saved.id);
      if (match) {
        const cardEl = document.getElementById(`card-${match.id}`);
        if (cardEl) cardEl.classList.add('selected');
      }
    }
  });
} else {
  const raw = localStorage.getItem('aura_profile');
  if (raw) {
    const saved = JSON.parse(raw);
    currentSelection = saved;
    applyToPreview(saved);
    updateCustomPanel(saved);
    updateProfileDisplay(saved);
  }
}
