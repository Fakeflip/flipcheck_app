/* Flipcheck Extension — Zalando Content Script */
(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
  panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('right',    '0',            'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('width',    'auto',         'important');
  document.documentElement.appendChild(panel);
  // Push page content so sidebar doesn't overlap
  (function () {
    function _syncBodyMargin(w, pos) {
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('margin-left');
      document.body.style.removeProperty('padding-bottom');
      if (pos === 'left')        document.body.style.setProperty('margin-left',    w + 'px', 'important');
      else if (pos === 'bottom') document.body.style.setProperty('padding-bottom', '320px',  'important');
      else                       document.body.style.setProperty('margin-right',   w + 'px', 'important');
    }
    // Default: right-docked at 380px
    try {
      chrome.storage.local.get('fc_position', r => {
        _syncBodyMargin(380, r?.fc_position || 'right');
      });
    } catch (_) { _syncBodyMargin(380, 'right'); }
    panel.addEventListener('fc-width-change', e => _syncBodyMargin(e.detail.w, e.detail.pos));
    panel.addEventListener('fc-close', () => {
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('margin-left');
      document.body.style.removeProperty('padding-bottom');
    });
    // Re-apply margin if SPA navigation resets body styles
    let _fcMg = false;
    new MutationObserver(() => {
      if (_fcMg || !document.body) return;
      const pos = panel._position || 'right';
      const ok  = (pos === 'left'   && document.body.style.marginLeft)   ||
                  (pos === 'bottom' && document.body.style.paddingBottom) ||
                  (pos !== 'left' && pos !== 'bottom' && document.body.style.marginRight);
      if (!ok) {
        _fcMg = true;
        try {
          chrome.storage.local.get('fc_position', r => {
            _syncBodyMargin(panel.offsetWidth || 380, r?.fc_position || 'right');
            setTimeout(() => { _fcMg = false; }, 300);
          });
        } catch (_) { _fcMg = false; }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  })();

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CONTEXT_EAN_PROBE' && msg.ean && typeof panel.probe === 'function') panel.probe(msg.ean);
  });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'f') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  // Read autoPanel setting, then try EAN extraction with retry
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const autoPanel = res?.data?.autoPanel !== false; // default: true
    tryExtract(autoPanel, 0);
  });

  function tryExtract(autoPanel, attempt) {
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }
    const ean = extractEanZalando();
    if (ean) {
      if (autoPanel) panel.probe(ean);
      else panel.setEan(ean);
      return;
    }
    if (attempt === 0) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, 1), 1500);
    } else if (attempt === 1) {
      setTimeout(() => tryExtract(autoPanel, 2), 3000);
    } else if (attempt === 2) {
      setTimeout(() => tryExtract(autoPanel, 3), 6000);
    }
    // attempt 3: stay on no-ean
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const ean = extractEanZalando();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // SPA navigation watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const n = extractEanZalando();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') panel.probe(n);
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
