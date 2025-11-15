(() => {
  // Grab elements (defensive)
  const form = document.getElementById('askForm');
  const askBtn = document.getElementById('ask');
  const q = document.getElementById('q');
  const ans = document.getElementById('answer');
  const statusEl = document.getElementById('status');
  const copyBtn = document.getElementById('copy');
  const speakBtn = document.getElementById('speak');
  const closeBtn = document.getElementById('closeBtn');
  const largeText = document.getElementById('largeText');
  const panelContent = document.getElementById('panelContent');

  // Helper to set status text
  function setStatus(text, temporary = true) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    if (temporary && text) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => statusEl.textContent = '', 2000);
    }
  }

  // Focus first field on load
  try { q?.focus(); } catch (e) { /* ignore */ }

  // Esc closes
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') parent.postMessage({ AURA_PANEL_CLOSE: true }, '*');
  });

  // Simple focus trap inside the panel
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => parent.postMessage({ AURA_PANEL_CLOSE: true }, '*'));
  }

  // Hide large text control (profile handles it)
  if (largeText) {
    const parentLabel = largeText.closest('label');
    if (parentLabel) parentLabel.style.display = 'none';
  }

  // Apply profile styles to panel
  function applyProfileToPanel(profile) {
      if (!profile || !panelContent) return;
      try {
        if (profile.bgColor) panelContent.style.backgroundColor = profile.bgColor;
        if (profile.textColor) panelContent.style.color = profile.textColor;
        if (profile.fontFamily) panelContent.style.fontFamily = profile.fontFamily;
        if (profile.fontSize) panelContent.style.fontSize = Math.min(profile.fontSize, 18) + 'px';
        if (profile.lineHeight) panelContent.style.lineHeight = profile.lineHeight;
        if (profile.letterSpacing !== undefined) panelContent.style.letterSpacing = (profile.letterSpacing || 0) + 'px';
        if (profile.wordSpacing !== undefined) panelContent.style.wordSpacing = (profile.wordSpacing || 0) + 'px';

        const header = document.querySelector('#panelContent header');
        if (header) {
            if (profile.bgColor) header.style.backgroundColor = profile.bgColor;
            if (profile.textColor) header.style.color = profile.textColor;
        }

        // ensure inputs/buttons inherit the chosen font/colors
        const style = document.createElement('style');
        style.setAttribute('data-aura-profile','1');
        style.textContent = `
            #panelContent input, #panelContent button, #panelContent textarea {
                ${profile.fontFamily ? `font-family: ${profile.fontFamily} !important;` : ''}
                ${profile.textColor ? `color: ${profile.textColor} !important;` : ''}
                font-size: ${Math.min(profile.fontSize || 14, 16)}px !important;
            }
        `;
        // remove previous profile style if present
        const prev = document.querySelector('style[data-aura-profile="1"]');
        if (prev) prev.remove();
        document.head.appendChild(style);
      } catch (err) {
        console.error('applyProfileToPanel error', err);
      }
  }

  // Listen for the profile message from the content script
  window.addEventListener('message', (e) => {
      try {
          if (e?.data?.AURA_PROFILE_LOAD && e.data.profile) {
              applyProfileToPanel(e.data.profile);
          }
      } catch(error){
          console.error('Side panel message handler error', error);
      }
  }, { passive: true });

  // helper that sends message to background and handles lastError
  function askBackground(question) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'AURA_PANEL_ASK', question }, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // form submit or fallback to ask button
  async function handleAsk(question) {
    if (!question) return;
    if (askBtn) askBtn.disabled = true;
    if (ans) ans.textContent = 'Thinking…';
    setStatus('');
    try {
      const data = await askBackground(question);
      renderAnswer(data);
    } catch (err) {
      if (ans) ans.textContent = '';
      setStatus('Could not get an answer.');
      console.error('Panel ask error', err);
    } finally {
      if (askBtn) askBtn.disabled = false;
      q?.focus();
    }
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const question = q?.value?.trim();
      if (!question) return;
      handleAsk(question);
    });
  } else if (askBtn) {
    askBtn.addEventListener('click', () => {
      const question = q?.value?.trim();
      if (!question) return;
      handleAsk(question);
    });
  }

  // Render answer safely
  function renderAnswer(data) {
    if (!ans) return;
    if (!data) { ans.textContent = 'No answer.'; return; }

    // pageUrl from background.js
    const pageUrl = data.pageUrl || '#';

    const citationsHtml = (data.citations || []).map(c => {
      try {
        if (c.anchor) return `<div style="font-size:12px;color:#555">Source: <a href="${pageUrl}${c.anchor}" target="_blank" rel="noopener">${escapeHtml(c.heading)}</a></div>`;
        return `<div style="font-size:12px;color:#555">Source: <em>${escapeHtml(c.heading)}</em></div>`;
      } catch (e) {
        return '';
      }
    }).join('');

    // Build the HTML (but keep content safe)
    const tldr = escapeHtml(data.tldr || '—');
    const bullets = (data.bullets || []).slice(0,5).map(b => `<li>${escapeHtml(b)}</li>`).join('');
    const details = data.details ? `<details style="margin-top:8px"><summary>If you need details</summary><div style="margin-top:6px">${escapeHtml(data.details)}</div></details>` : '';

    ans.innerHTML = `
      <div><strong>TL;DR:</strong> ${tldr}</div>
      ${bullets ? `<ul style="margin:8px 0 0 18px">${bullets}</ul>` : ''}
      ${details}
      ${citationsHtml}
    `;
    setStatus('Answer loaded', true);
  }

  // Escape HTML to be safe
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // Copy: use textContent (reliable) and fallback for older permissions
  async function copyAnswerToClipboard() {
    if (!ans) return false;
    const text = (ans.textContent || '').trim();
    if (!text) return false;

    // Preferred modern API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // fall through to fallback
        console.warn('navigator.clipboard failed, falling back', err);
      }
    }

    // Fallback: temporary textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (err) {
      console.error('fallback copy failed', err);
      return false;
    }
  }

  // Copy button handler
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const ok = await copyAnswerToClipboard();
        setStatus(ok ? 'Copied.' : 'Copy failed.');
      } catch {
        setStatus('Copy failed.');
      }
    });
  }

  // Speak button handler (send to background TTS)
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      try {
        const text = (ans?.textContent || '').slice(0, 1000);
        chrome.runtime.sendMessage({ type:'AURA_TTS', text });
        setStatus('Speaking…', true);
      } catch (e) {
        setStatus('Speech failed.');
        console.error('TTS error', e);
      }
    });
  }

  // Expose a small API for tests (optional)
  window.__AURA_PANEL = {
    renderAnswer,
    applyProfileToPanel,
    copyAnswerToClipboard
  };

})();
