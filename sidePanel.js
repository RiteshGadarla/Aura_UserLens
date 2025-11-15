// sidePanel.js (fixed / defensive)
(() => {
  // Grab elements (some may be missing in older html variations — defend)
  const form = document.getElementById('askForm');
  const askBtn = document.getElementById('ask');
  const q = document.getElementById('q');
  const ans = document.getElementById('answer');
  const statusEl = document.getElementById('status');
  const copyBtn = document.getElementById('copy');
  const speakBtn = document.getElementById('speak');
  const closeBtn = document.getElementById('closeBtn');
  const largeText = document.getElementById('largeText');
  // FIX: New element reference for applying styles
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
    const focusables = [...document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => parent.postMessage({ AURA_PANEL_CLOSE: true }, '*'));
  }

  // FIX: Remove large text toggle and logic (it's now handled by the profile)
  if (largeText) {
    // Large text is now redundant. Hide it.
    const parentLabel = largeText.closest('label');
    if (parentLabel) parentLabel.style.display = 'none';
  }

  // FIX: Add function to apply the profile settings to the panel
  function applyProfileToPanel(profile) {
      if (!profile || !panelContent) return;
      
      // Apply profile styles to the wrapper
      panelContent.style.backgroundColor = profile.bgColor;
      panelContent.style.color = profile.textColor;
      panelContent.style.fontFamily = profile.fontFamily;
      // Use profile.fontSize for base text, but perhaps a slightly smaller size for the dense panel
      panelContent.style.fontSize = Math.min(profile.fontSize, 18) + 'px'; 
      panelContent.style.lineHeight = profile.lineHeight;
      panelContent.style.letterSpacing = (profile.letterSpacing || 0) + 'px';
      panelContent.style.wordSpacing = (profile.wordSpacing || 0) + 'px';

      // Also adjust the header background for contrast/consistency
      const header = document.querySelector('#panelContent header');
      if (header) {
          header.style.backgroundColor = profile.bgColor;
          header.style.color = profile.textColor;
      }

      // We need a subtle fix for input/button elements which often ignore parent styles
      const style = document.createElement('style');
      style.textContent = `
          #panelContent input, #panelContent button {
              font-family: ${profile.fontFamily} !important;
              color: ${profile.textColor} !important;
              font-size: ${Math.min(profile.fontSize, 16)}px !important;
          }
      `;
      document.head.appendChild(style);
  }

  // FIX: Listen for the profile message from the content script
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

  // If no form exists, fallback to button click
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = q?.value?.trim();
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
    });
  } else if (askBtn) {
    askBtn.addEventListener('click', async () => {
      const question = q?.value?.trim();
      if (!question) return;
      askBtn.disabled = true;
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
        askBtn.disabled = false;
        q?.focus();
      }
    });
  }

  function renderAnswer(data) {
    if (!ans) return;
    if (!data) { ans.textContent = 'No answer.'; return; }
    
    // FIX: Get pageUrl from the data object returned by background.js
    const pageUrl = data.pageUrl || '#'; 

    const citationsHtml = (data.citations || []).map(c => {
      // FIX: Use the pageUrl variable to correctly form the full citation anchor link
      if (c.anchor) return `<div style="font-size:12px;color:#555">Source: <a href="${pageUrl}${c.anchor}" target="_blank" rel="noopener">${escapeHtml(c.heading)}</a></div>`;
      return `<div style="font-size:12px;color:#555">Source: <em>${escapeHtml(c.heading)}</em></div>`;
    }).join('');
    ans.innerHTML = `
      <div><strong>TL;DR:</strong> ${escapeHtml(data.tldr || '—')}</div>
      <ul style="margin:8px 0 0 18px">${(data.bullets||[]).slice(0,5).map(b=>`<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${data.details ? `<details style="margin-top:8px"><summary>If you need details</summary><div style="margin-top:6px">${escapeHtml(data.details)}</div></details>` : ''}
      ${citationsHtml}
    `;
    setStatus('Answer loaded', true);
  }


  // Escape HTML to be safe
  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // Copy & Speak
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ans?.innerText || '');
        setStatus('Copied.');
      } catch {
        setStatus('Copy failed.');
      }
    });
  }

  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type:'AURA_TTS', text: (ans?.innerText || '').slice(0, 1000) });
        setStatus('Speaking…', true);
      } catch (e) {
        setStatus('Speech failed.');
      }
    });
  }

})();