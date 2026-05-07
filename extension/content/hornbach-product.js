/* Flipcheck Extension — Hornbach Content Script */
(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
    panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('left',     '0',            'important');
  panel.style.setProperty('right',    'auto',         'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('width',    '100vw',        'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('background', 'transparent', 'important');
  panel.style.setProperty('color-scheme', 'dark',     'important');
  panel.style.setProperty('margin',   '0',            'important');
  panel.style.setProperty('padding',  '0',            'important');
  panel.style.setProperty('border',   'none',         'important');
  panel.style.setProperty('opacity',  '1',            'important');
  panel.style.setProperty('visibility', 'visible',    'important');
  panel.style.setProperty('transform', 'none',        'important');
  panel.style.setProperty('max-width', 'none',        'important');
  panel.style.setProperty('min-width', '0',           'important');
  panel.style.setProperty('overflow',  'visible',     'important');
  panel.style.setProperty('float',     'none',        'important');
  panel.style.setProperty('clear',     'none',        'important');
  panel.style.setProperty('isolation', 'isolate',     'important');
  panel.style.setProperty('pointer-events', 'none',   'important');
  document.documentElement.appendChild(panel);
  // v7: Panel floats — no body-margin push needed.
  try {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('padding-bottom');
  } catch (_) {}

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
    const ean = extractEanHornbach();
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
    const ean = extractEanHornbach();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // SPA navigation watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const n = extractEanHornbach();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') panel.probe(n);
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
