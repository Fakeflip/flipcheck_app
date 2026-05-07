/* Flipcheck Extension — Floating Multi-Market Panel v7
 * Floating bottom-right window, all markets visible at once as stacked cards,
 * drag + resize anywhere, clean Linear-inspired aesthetic.
 *
 * Public API (unchanged from v6):
 *   panel.probe(ean), panel.setState(state), panel.autofillEk(price),
 *   panel.currentEan, panel.setEan(ean), panel.setCrossId(id),
 *   panel.setIdentifier(id), panel.setAmzCategory(cat)
 *
 * Events: fc-close, fc-manual-ean, fc-disconnected
 *
 * SECURITY NOTE: innerHTML is used only with:
 *   (a) trusted static template strings (PANEL_HTML, buildCardHTML)
 *   (b) data passed through esc() helper for HTML-escaping
 *   All operations happen inside a closed shadow DOM.
 */
(function () {
  if (window._fcPanelDef) return;
  window._fcPanelDef = true;

  // CSS — Linear/Vercel-inspired clean dark aesthetic
  const PANEL_CSS = `
    :host { all: initial !important; position: fixed !important; z-index: 2147483647 !important; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important; display: block !important; pointer-events: none !important; color-scheme: dark !important; background: transparent !important; color: #F1F5F9 !important; margin: 0 !important; padding: 0 !important; border: none !important; opacity: 1 !important; visibility: visible !important; transform: none !important; overflow: visible !important; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    button, input, select { font-family: inherit; font-size: inherit; }
    input[type=number] { -moz-appearance: textfield; }
    input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }

    /* Floating window shell */
    .fc-window { position: absolute; width: 440px; height: 720px; min-width: 360px; min-height: 400px; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; background: #0A0A0F; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04) inset; overflow: hidden; pointer-events: auto; backdrop-filter: blur(20px); }
    .fc-window.dragging { transition: none; cursor: grabbing; user-select: none; }
    .fc-window.resizing { transition: none; user-select: none; }

    /* Header (drag-handle) */
    .fc-header { flex-shrink: 0; padding: 12px 14px 10px; cursor: grab; user-select: none; position: relative; background: linear-gradient(180deg, rgba(20,20,30,0.7) 0%, rgba(10,10,15,0.5) 100%); border-bottom: 1px solid rgba(255,255,255,0.04); }
    .fc-header:active { cursor: grabbing; }
    .fc-hdr-row { display: flex; align-items: center; gap: 8px; }
    .fc-logo { font-size: 11px; font-weight: 800; color: #818CF8; letter-spacing: 0.08em; flex-shrink: 0; }
    .fc-product-title { flex: 1; font-size: 12px; font-weight: 600; color: #F1F5F9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .fc-hdr-btn { background: none; border: none; color: #475569; cursor: pointer; width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 12px; line-height: 1; transition: color 120ms, background 120ms; }
    .fc-hdr-btn:hover { color: #94A3B8; background: rgba(255,255,255,0.04); }
    .fc-hdr-btn.danger:hover { color: #EF4444; background: rgba(239,68,68,0.08); }

    /* IDs row */
    .fc-ids { display: flex; gap: 12px; margin-top: 8px; font-size: 10px; color: #475569; letter-spacing: 0.02em; }
    .fc-id-pair { display: flex; align-items: center; gap: 4px; cursor: copy; transition: color 120ms; }
    .fc-id-pair:hover { color: #94A3B8; }
    .fc-id-key { font-weight: 700; color: #64748B; }
    .fc-id-val { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #94A3B8; }
    .fc-id-val.empty { color: #334155; font-style: italic; }

    /* EK input bar */
    .fc-ek-bar { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(15,15,22,0.5); border-bottom: 1px solid rgba(255,255,255,0.04); }
    .fc-ek-label { font-size: 10px; font-weight: 700; color: #64748B; letter-spacing: 0.08em; }
    .fc-ek-input-wrap { flex: 1; position: relative; }
    .fc-ek-input { width: 100%; padding: 6px 22px 6px 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; color: #F1F5F9; font-size: 13px; font-weight: 600; font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; outline: none; transition: border-color 120ms, background 120ms; }
    .fc-ek-input:focus { border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.06); }
    .fc-ek-input-wrap::after { content: "€"; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: #475569; font-size: 11px; pointer-events: none; }
    .fc-ek-mode { display: flex; gap: 1px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 1px; }
    .fc-ek-mode-btn { background: none; border: none; cursor: pointer; padding: 4px 8px; font-size: 10px; font-weight: 700; color: #475569; letter-spacing: 0.04em; border-radius: 4px; transition: color 120ms, background 120ms; }
    .fc-ek-mode-btn:hover { color: #94A3B8; }
    .fc-ek-mode-btn.active { color: #A5B4FC; background: rgba(99,102,241,0.12); }

    /* Cards stack (scrollable) */
    .fc-stack { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 10px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: #1E1E2E transparent; }
    .fc-stack::-webkit-scrollbar { width: 6px; }
    .fc-stack::-webkit-scrollbar-track { background: transparent; }
    .fc-stack::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
    .fc-stack::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }

    /* Card */
    .fc-card { background: #111118; border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; overflow: hidden; transition: border-color 150ms; }
    .fc-card:hover { border-color: rgba(255,255,255,0.08); }
    .fc-card-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .fc-card-mkt { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; flex-shrink: 0; }
    .fc-card-mkt.ebay { color: #818CF8; }
    .fc-card-mkt.amazon { color: #FBA85F; }
    .fc-card-mkt.kaufland { color: #F87171; }
    .fc-verdict { font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 999px; letter-spacing: 0.08em; text-transform: uppercase; }
    .fc-verdict.buy { color: #6EE7B7; background: rgba(16,185,129,0.12); }
    .fc-verdict.hold { color: #FCD34D; background: rgba(245,158,11,0.12); }
    .fc-verdict.skip { color: #FCA5A5; background: rgba(239,68,68,0.10); }
    .fc-verdict.idle { color: #475569; background: rgba(148,163,184,0.06); }
    .fc-margin { font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #94A3B8; margin-left: auto; }
    .fc-margin.pos { color: #6EE7B7; }
    .fc-margin.neg { color: #FCA5A5; }
    .fc-card-body { padding: 10px 12px; }

    /* KPI grid */
    .fc-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .fc-kpi { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .fc-kpi-label { font-size: 9px; font-weight: 700; color: #475569; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
    .fc-kpi-val { font-size: 13px; font-weight: 700; color: #F1F5F9; font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fc-kpi-val.muted { color: #475569; font-weight: 500; }
    .fc-kpi-val.pos { color: #6EE7B7; }
    .fc-kpi-val.neg { color: #FCA5A5; }
    .fc-kpi-sub { font-size: 9px; color: #475569; white-space: nowrap; }

    /* Skeleton */
    .fc-card.skeleton .fc-kpi-val { color: transparent; background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: fc-shimmer 1.5s infinite; border-radius: 4px; min-height: 14px; }
    .fc-card.skeleton .fc-margin { color: transparent; }
    @keyframes fc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes fc-spin { to { transform: rotate(360deg); } }

    /* Empty card state */
    .fc-card.empty .fc-card-body { padding: 20px 12px; text-align: center; }
    .fc-empty-msg { font-size: 11px; color: #475569; margin-bottom: 8px; }
    .fc-empty-action { background: rgba(99,102,241,0.10); border: 1px solid rgba(99,102,241,0.2); color: #A5B4FC; padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; }
    .fc-empty-action:hover { background: rgba(99,102,241,0.18); }

    /* Expandable details */
    .fc-card-details { padding: 0 12px; max-height: 0; overflow: hidden; transition: max-height 200ms ease-out, padding 200ms ease-out; border-top: 0 solid rgba(255,255,255,0.04); }
    .fc-card.open .fc-card-details { max-height: 600px; padding: 8px 12px 12px; border-top-width: 1px; }
    .fc-detail-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 11px; border-bottom: 1px dashed rgba(255,255,255,0.03); }
    .fc-detail-row:last-child { border-bottom: none; }
    .fc-detail-label { color: #64748B; }
    .fc-detail-val { color: #CBD5E1; font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-weight: 600; }
    .fc-detail-val.profit-pos { color: #6EE7B7; }
    .fc-detail-val.profit-neg { color: #FCA5A5; }
    .fc-card-toggle { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; padding: 6px; background: none; border: none; border-top: 1px solid rgba(255,255,255,0.03); color: #64748B; cursor: pointer; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; transition: color 120ms, background 120ms; }
    .fc-card-toggle:hover { color: #94A3B8; background: rgba(255,255,255,0.02); }
    .fc-card-toggle .arrow { transition: transform 200ms; }
    .fc-card.open .fc-card-toggle .arrow { transform: rotate(180deg); }

    /* Card actions */
    .fc-card-actions { display: flex; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.03); }
    .fc-card-action { flex: 1; padding: 5px 6px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 5px; color: #94A3B8; cursor: pointer; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-decoration: none; text-align: center; transition: background 120ms, color 120ms, border-color 120ms; }
    .fc-card-action:hover { background: rgba(255,255,255,0.05); color: #F1F5F9; border-color: rgba(255,255,255,0.08); }
    .fc-card-action.primary { background: rgba(99,102,241,0.10); border-color: rgba(99,102,241,0.2); color: #A5B4FC; }
    .fc-card-action.primary:hover { background: rgba(99,102,241,0.18); }

    /* Footer */
    .fc-footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-top: 1px solid rgba(255,255,255,0.04); background: rgba(10,10,15,0.5); font-size: 10px; color: #475569; }
    .fc-footer-left { display: flex; align-items: center; gap: 8px; }
    .fc-footer-btn { background: none; border: none; color: #475569; cursor: pointer; font-size: 10px; font-weight: 600; transition: color 120ms; }
    .fc-footer-btn:hover { color: #94A3B8; }

    /* Resize handles (8 edges) */
    .fc-resize { position: absolute; z-index: 10; }
    .fc-resize-n { top: -3px; left: 6px; right: 6px; height: 6px; cursor: n-resize; }
    .fc-resize-s { bottom: -3px; left: 6px; right: 6px; height: 6px; cursor: s-resize; }
    .fc-resize-e { right: -3px; top: 6px; bottom: 6px; width: 6px; cursor: e-resize; }
    .fc-resize-w { left: -3px; top: 6px; bottom: 6px; width: 6px; cursor: w-resize; }
    .fc-resize-ne { top: -3px; right: -3px; width: 12px; height: 12px; cursor: ne-resize; }
    .fc-resize-nw { top: -3px; left: -3px; width: 12px; height: 12px; cursor: nw-resize; }
    .fc-resize-se { bottom: -3px; right: -3px; width: 14px; height: 14px; cursor: se-resize; }
    .fc-resize-sw { bottom: -3px; left: -3px; width: 12px; height: 12px; cursor: sw-resize; }
    .fc-resize-se::after { content: ""; position: absolute; bottom: 4px; right: 4px; width: 6px; height: 6px; background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%); }

    /* Empty state */
    .fc-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; padding: 40px 20px; text-align: center; }
    .fc-empty-icon { font-size: 32px; margin-bottom: 10px; opacity: 0.4; }
    .fc-empty-title { font-size: 13px; font-weight: 700; color: #94A3B8; margin-bottom: 4px; }
    .fc-empty-desc { font-size: 11px; color: #475569; margin-bottom: 16px; max-width: 240px; line-height: 1.5; }
    .fc-empty-cta { background: rgba(99,102,241,0.10); border: 1px solid rgba(99,102,241,0.2); color: #A5B4FC; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; }
    .fc-empty-cta:hover { background: rgba(99,102,241,0.18); }

    /* Minimized state */
    :host([data-minimized]) .fc-window { height: auto !important; }
    :host([data-minimized]) .fc-ek-bar, :host([data-minimized]) .fc-stack, :host([data-minimized]) .fc-footer, :host([data-minimized]) .fc-resize { display: none !important; }
  `;

  // Static HTML template — controlled content, safe for innerHTML in shadow DOM
  const PANEL_HTML = `
    <style>${PANEL_CSS}</style>
    <div class="fc-window" id="fcWindow">
      <div class="fc-resize fc-resize-n" data-rs="n"></div>
      <div class="fc-resize fc-resize-s" data-rs="s"></div>
      <div class="fc-resize fc-resize-e" data-rs="e"></div>
      <div class="fc-resize fc-resize-w" data-rs="w"></div>
      <div class="fc-resize fc-resize-ne" data-rs="ne"></div>
      <div class="fc-resize fc-resize-nw" data-rs="nw"></div>
      <div class="fc-resize fc-resize-se" data-rs="se"></div>
      <div class="fc-resize fc-resize-sw" data-rs="sw"></div>
      <div class="fc-header" id="fcHeader">
        <div class="fc-hdr-row">
          <span class="fc-logo">▲ FC</span>
          <span class="fc-product-title" id="fcTitle">Flipcheck</span>
          <button class="fc-hdr-btn" id="fcMinBtn" title="Minimieren">—</button>
          <button class="fc-hdr-btn" id="fcSettingsBtn" title="Einstellungen">⚙</button>
          <button class="fc-hdr-btn danger" id="fcCloseBtn" title="Schließen">✕</button>
        </div>
        <div class="fc-ids">
          <div class="fc-id-pair" id="fcEanPair" title="EAN kopieren">
            <span class="fc-id-key">EAN</span>
            <span class="fc-id-val empty" id="fcEanVal">—</span>
          </div>
          <div class="fc-id-pair" id="fcAsinPair" title="ASIN kopieren">
            <span class="fc-id-key">ASIN</span>
            <span class="fc-id-val empty" id="fcAsinVal">—</span>
          </div>
        </div>
      </div>
      <div class="fc-ek-bar">
        <span class="fc-ek-label">EK</span>
        <div class="fc-ek-input-wrap">
          <input type="number" class="fc-ek-input" id="fcEkInput" step="0.01" placeholder="0,00">
        </div>
        <div class="fc-ek-mode">
          <button class="fc-ek-mode-btn active" data-mode="mid">M</button>
          <button class="fc-ek-mode-btn" data-mode="low" title="Niedriger Verkaufspreis">L</button>
          <button class="fc-ek-mode-btn" data-mode="high" title="Höherer Verkaufspreis">H</button>
        </div>
      </div>
      <div class="fc-stack" id="fcStack">
        <div class="fc-empty-state" id="fcEmptyState">
          <div class="fc-empty-icon">⌕</div>
          <div class="fc-empty-title">Keine EAN erkannt</div>
          <div class="fc-empty-desc">Flipcheck konnte auf dieser Seite keinen EAN finden. Klick "Manuell scannen" oder geh auf eine Produktseite.</div>
          <button class="fc-empty-cta" id="fcManualScan">Manuell scannen</button>
        </div>
      </div>
      <div class="fc-footer">
        <div class="fc-footer-left">
          <span id="fcStatusDot">●</span>
          <span id="fcStatusText">Bereit</span>
        </div>
        <button class="fc-footer-btn" id="fcResetPos" title="Position zurücksetzen">⟲</button>
      </div>
    </div>
  `;

  // Card template — static HTML with safe placeholder structure
  // (data is filled in via textContent / className later, never via innerHTML+user-data)
  function buildCardHTML(mkt) {
    const names = { ebay: 'EBAY', amazon: 'AMAZON', kaufland: 'KAUFLAND' };
    const name = names[mkt];
    const openName = name.charAt(0) + name.slice(1).toLowerCase();
    return `
      <div class="fc-card skeleton" data-mkt="${mkt}" id="fcCard-${mkt}">
        <div class="fc-card-head">
          <span class="fc-card-mkt ${mkt}">${name}</span>
          <span class="fc-verdict idle" data-fc="verdict">—</span>
          <span class="fc-margin" data-fc="margin">—</span>
        </div>
        <div class="fc-card-body">
          <div class="fc-kpi-grid">
            <div class="fc-kpi"><div class="fc-kpi-label">Profit</div><div class="fc-kpi-val" data-fc="profit">—</div><div class="fc-kpi-sub" data-fc="profit-sub"></div></div>
            <div class="fc-kpi"><div class="fc-kpi-label">VK</div><div class="fc-kpi-val" data-fc="vk">—</div><div class="fc-kpi-sub" data-fc="vk-sub"></div></div>
            <div class="fc-kpi"><div class="fc-kpi-label" data-fc="kpi3-label">Verkäufe</div><div class="fc-kpi-val" data-fc="kpi3">—</div><div class="fc-kpi-sub" data-fc="kpi3-sub"></div></div>
            <div class="fc-kpi"><div class="fc-kpi-label" data-fc="kpi4-label">Tage</div><div class="fc-kpi-val" data-fc="kpi4">—</div><div class="fc-kpi-sub" data-fc="kpi4-sub"></div></div>
          </div>
          <div class="fc-card-actions">
            <a class="fc-card-action primary" data-fc="open-url" target="_blank" rel="noopener">Auf ${openName} öffnen</a>
            <button class="fc-card-action" data-fc="add-inv">Inventory</button>
            <button class="fc-card-action" data-fc="alert">Alarm</button>
          </div>
        </div>
        <div class="fc-card-details" data-fc="details"></div>
        <button class="fc-card-toggle" data-fc="toggle"><span data-fc="toggle-text">Details</span><span class="arrow">▾</span></button>
      </div>
    `;
  }

  // Helpers
  const eur = (v) => v == null || isNaN(v) ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
  const pct = (v) => v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  const num = (v) => v == null || isNaN(v) ? "—" : new Intl.NumberFormat("de-DE").format(v);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  // FlipcheckPanel — Custom Element
  class FlipcheckPanel extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'closed' });
      // Static template — safe innerHTML
      shadow.innerHTML = PANEL_HTML;
      this._shadow = shadow;

      // Defensive inline styles on host
      const HOST_STYLES = {
        position: 'fixed', display: 'block', 'z-index': '2147483647',
        top: '0', left: '0', right: 'auto', bottom: 'auto',
        width: '100vw', height: '100vh',
        background: 'transparent', 'color-scheme': 'dark',
        margin: '0', padding: '0', border: 'none',
        opacity: '1', visibility: 'visible', transform: 'none',
        'pointer-events': 'none', isolation: 'isolate', overflow: 'visible',
      };
      const _applyHost = () => {
        for (const [k, v] of Object.entries(HOST_STYLES)) {
          this.style.setProperty(k, v, 'important');
        }
      };
      _applyHost();
      new MutationObserver(() => {
        if (this.style.getPropertyValue('background') !== 'transparent') _applyHost();
      }).observe(this, { attributes: true, attributeFilter: ['style'] });

      this._currentEan = null;
      this._currentAsin = null;
      this._lastEk = 0;
      this._mode = 'mid';
      this._results = { ebay: null, amazon: null, kaufland: null };

      this._initWindow();
      this._wireEvents();
      this._initFromStorage();
    }

    // ── Public API ──
    get currentEan() { return this._currentEan; }
    setEan(ean) { this._currentEan = ean ? String(ean).replace(/\D/g, "") : null; this._updateIdsBar(); }
    setIdentifier(id) { this.setEan(id); }
    setCrossId(id) {
      if (id && /^[A-Z0-9]{10}$/.test(id)) this._currentAsin = id;
      else if (id && /^\d{8,14}$/.test(id)) this._currentEan = id;
      this._updateIdsBar();
    }
    setAmzCategory(_cat) {}
    autofillEk(price) {
      if (!price || price <= 0) return;
      const inp = this._shadow.getElementById('fcEkInput');
      if (inp && (!inp.value || parseFloat(inp.value) === 0)) {
        inp.value = price.toFixed(2);
        this._lastEk = price;
        if (this._results.ebay || this._results.amazon || this._results.kaufland) {
          this.probe(this._currentEan);
        }
      }
    }
    setState(state) {
      const empty = this._shadow.getElementById('fcEmptyState');
      const stack = this._shadow.getElementById('fcStack');
      const status = this._shadow.getElementById('fcStatusText');
      if (state === 'no-ean') {
        if (empty) empty.style.display = '';
        stack.querySelectorAll('.fc-card').forEach(c => c.remove());
        if (status) status.textContent = 'Keine EAN';
      } else if (state === 'loading') {
        this._renderSkeletons();
        if (status) status.textContent = 'Lade…';
      } else if (state === 'ready') {
        if (status) status.textContent = 'Bereit';
      }
    }
    probe(ean) {
      if (!ean) return;
      this._currentEan = String(ean).replace(/\D/g, "");
      const ekRaw = this._shadow.getElementById('fcEkInput')?.value;
      this._lastEk = parseFloat(ekRaw) || 0;
      const empty = this._shadow.getElementById('fcEmptyState');
      if (empty) empty.style.display = 'none';
      this._renderSkeletons();
      this._updateIdsBar();
      this._fetchAllMarkets();
    }

    // ── Window init + drag/resize/persist ──
    _initWindow() {
      const win = this._shadow.getElementById('fcWindow');
      const dw = 440, dh = 720;
      win.style.left = (window.innerWidth - dw - 16) + 'px';
      win.style.top  = (window.innerHeight - dh - 16) + 'px';
      win.style.width  = dw + 'px';
      win.style.height = Math.min(dh, window.innerHeight - 32) + 'px';
    }
    _initFromStorage() {
      try {
        chrome.storage.sync.get(['fc_panel_pos', 'fc_panel_size'], (r) => {
          const win = this._shadow.getElementById('fcWindow');
          if (!win) return;
          const pos = r?.fc_panel_pos, size = r?.fc_panel_size;
          if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            const x = Math.max(0, Math.min(pos.x, window.innerWidth - 100));
            const y = Math.max(0, Math.min(pos.y, window.innerHeight - 100));
            win.style.left = x + 'px';
            win.style.top  = y + 'px';
          }
          if (size && size.w && size.h) {
            win.style.width  = Math.max(360, Math.min(size.w, window.innerWidth)) + 'px';
            win.style.height = Math.max(400, Math.min(size.h, window.innerHeight)) + 'px';
          }
        });
      } catch (_) {}
    }
    _persistPos() {
      const win = this._shadow.getElementById('fcWindow');
      if (!win) return;
      const x = parseInt(win.style.left, 10) || 0;
      const y = parseInt(win.style.top, 10) || 0;
      try { chrome.storage.sync.set({ fc_panel_pos: { x, y } }); } catch(_){}
    }
    _persistSize() {
      const win = this._shadow.getElementById('fcWindow');
      if (!win) return;
      const w = parseInt(win.style.width, 10) || 440;
      const h = parseInt(win.style.height, 10) || 720;
      try { chrome.storage.sync.set({ fc_panel_size: { w, h } }); } catch(_){}
    }

    _wireEvents() {
      const s = this._shadow;
      const win = s.getElementById('fcWindow');
      const header = s.getElementById('fcHeader');

      // Drag (header)
      let dragStart = null;
      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const rect = win.getBoundingClientRect();
        dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        win.classList.add('dragging');
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragStart) return;
        const x = Math.max(0, Math.min(e.clientX - dragStart.x, window.innerWidth - 80));
        const y = Math.max(0, Math.min(e.clientY - dragStart.y, window.innerHeight - 40));
        win.style.left = x + 'px';
        win.style.top  = y + 'px';
        win.style.right = 'auto';
        win.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => {
        if (!dragStart) return;
        dragStart = null;
        win.classList.remove('dragging');
        this._persistPos();
      });

      // Resize (8 edges)
      let rs = null;
      s.querySelectorAll('.fc-resize').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
          const dir = handle.dataset.rs;
          const rect = win.getBoundingClientRect();
          rs = { dir, startX: e.clientX, startY: e.clientY,
                 startW: rect.width, startH: rect.height,
                 startL: rect.left, startT: rect.top };
          win.classList.add('resizing');
          e.preventDefault(); e.stopPropagation();
        });
      });
      document.addEventListener('mousemove', (e) => {
        if (!rs) return;
        const dx = e.clientX - rs.startX, dy = e.clientY - rs.startY;
        let nw = rs.startW, nh = rs.startH, nl = rs.startL, nt = rs.startT;
        if (rs.dir.includes('e')) nw = Math.max(360, rs.startW + dx);
        if (rs.dir.includes('w')) { nw = Math.max(360, rs.startW - dx); nl = rs.startL + (rs.startW - nw); }
        if (rs.dir.includes('s')) nh = Math.max(400, rs.startH + dy);
        if (rs.dir.includes('n')) { nh = Math.max(400, rs.startH - dy); nt = rs.startT + (rs.startH - nh); }
        nw = Math.min(nw, window.innerWidth - nl);
        nh = Math.min(nh, window.innerHeight - nt);
        win.style.width  = nw + 'px'; win.style.height = nh + 'px';
        win.style.left   = nl + 'px'; win.style.top    = nt + 'px';
        win.style.right  = 'auto'; win.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => {
        if (!rs) return;
        rs = null;
        win.classList.remove('resizing');
        this._persistSize();
        this._persistPos();
      });

      // Header buttons
      s.getElementById('fcCloseBtn')?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('fc-close', { bubbles: true }));
        this.style.setProperty('display', 'none', 'important');
      });
      s.getElementById('fcMinBtn')?.addEventListener('click', () => {
        this.hasAttribute('data-minimized')
          ? this.removeAttribute('data-minimized')
          : this.setAttribute('data-minimized', '');
      });
      s.getElementById('fcSettingsBtn')?.addEventListener('click', () => {
        // Phase 2: Settings overlay
      });
      s.getElementById('fcResetPos')?.addEventListener('click', () => {
        this._initWindow();
        this._persistPos();
        this._persistSize();
      });

      // EK input
      const ekInput = s.getElementById('fcEkInput');
      ekInput?.addEventListener('input', () => {
        this._lastEk = parseFloat(ekInput.value) || 0;
      });
      ekInput?.addEventListener('change', () => {
        if (this._currentEan && this._lastEk > 0) this.probe(this._currentEan);
      });

      // Mode buttons
      s.querySelectorAll('.fc-ek-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._mode = btn.dataset.mode;
          s.querySelectorAll('.fc-ek-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
          if (this._currentEan) this.probe(this._currentEan);
        });
      });

      // Manual scan
      s.getElementById('fcManualScan')?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('fc-manual-ean', { bubbles: true }));
      });

      // Copy IDs
      s.getElementById('fcEanPair')?.addEventListener('click', () => {
        if (this._currentEan) navigator.clipboard?.writeText(this._currentEan);
      });
      s.getElementById('fcAsinPair')?.addEventListener('click', () => {
        if (this._currentAsin) navigator.clipboard?.writeText(this._currentAsin);
      });
    }

    disconnectedCallback() {
      this.dispatchEvent(new CustomEvent('fc-disconnected', { bubbles: false }));
    }

    // ── Render ──
    _renderSkeletons() {
      const stack = this._shadow.getElementById('fcStack');
      const empty = this._shadow.getElementById('fcEmptyState');
      if (empty) empty.style.display = 'none';
      ['ebay', 'amazon', 'kaufland'].forEach(mkt => {
        let card = stack.querySelector('#fcCard-' + mkt);
        if (!card) {
          // Static card template — safe innerHTML insertion
          stack.insertAdjacentHTML('beforeend', buildCardHTML(mkt));
          card = stack.querySelector('#fcCard-' + mkt);
          this._wireCard(card, mkt);
        }
        card.classList.add('skeleton');
        card.classList.remove('empty', 'open');
      });
    }
    _wireCard(card, mkt) {
      card.querySelector('[data-fc="toggle"]')?.addEventListener('click', () => {
        card.classList.toggle('open');
        const txt = card.querySelector('[data-fc="toggle-text"]');
        if (txt) txt.textContent = card.classList.contains('open') ? 'Weniger' : 'Details';
      });
      card.querySelector('[data-fc="add-inv"]')?.addEventListener('click', () => {
        const data = this._results[mkt];
        if (!data) return;
        chrome.runtime.sendMessage({
          type: 'INVENTORY_ADD', market: mkt, ean: this._currentEan,
          asin: this._currentAsin, ek: this._lastEk, data,
        });
      });
      card.querySelector('[data-fc="alert"]')?.addEventListener('click', () => {
        const data = this._results[mkt];
        if (!data) return;
        chrome.runtime.sendMessage({
          type: 'PRICE_ALERT_OPEN', market: mkt, ean: this._currentEan,
          asin: this._currentAsin, current: data.sell_price_median || data.sell_price_avg,
        });
      });
    }
    _updateIdsBar() {
      const eanEl = this._shadow.getElementById('fcEanVal');
      const asinEl = this._shadow.getElementById('fcAsinVal');
      if (eanEl) {
        eanEl.textContent = this._currentEan || '—';
        eanEl.classList.toggle('empty', !this._currentEan);
      }
      if (asinEl) {
        asinEl.textContent = this._currentAsin || '—';
        asinEl.classList.toggle('empty', !this._currentAsin);
      }
    }

    // ── Data fetch — all 3 markets in parallel ──
    _fetchAllMarkets() {
      if (!this._currentEan) return;
      const ek = this._lastEk, mode = this._mode;

      // eBay (always)
      chrome.runtime.sendMessage({
        type: 'FLIPCHECK', ean: this._currentEan, ek, mode, market: 'ebay',
      }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          this._renderCardError('ebay', 'Konnte nicht geladen werden'); return;
        }
        this._results.ebay = res.data;
        if (res.data?.asin && !this._currentAsin) {
          this._currentAsin = res.data.asin;
          this._updateIdsBar();
        }
        this._renderCard('ebay', res.data);
      });

      // Amazon — needs ASIN
      const fetchAmazon = (asin) => {
        chrome.runtime.sendMessage({
          type: 'AMAZON_CHECK', asin, ean: this._currentEan, ek, mode, method: 'fba',
        }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            this._renderCardError('amazon', 'Konnte nicht geladen werden'); return;
          }
          this._results.amazon = res.data;
          this._renderCard('amazon', res.data);
        });
      };
      if (this._currentAsin) {
        fetchAmazon(this._currentAsin);
      } else {
        chrome.runtime.sendMessage({ type: 'EAN_TO_ASIN', ean: this._currentEan }, (res) => {
          if (chrome.runtime.lastError || !res?.ok || !res.asin) {
            this._renderCardEmpty('amazon', 'Auf Amazon nicht gefunden'); return;
          }
          this._currentAsin = res.asin;
          this._updateIdsBar();
          fetchAmazon(res.asin);
        });
      }

      // Kaufland (uses EAN)
      chrome.runtime.sendMessage({
        type: 'FLIPCHECK', ean: this._currentEan, ek, mode, market: 'kaufland',
      }, (res) => {
        if (chrome.runtime.lastError) {
          this._renderCardError('kaufland', 'Konnte nicht geladen werden'); return;
        }
        if (!res?.ok || !res.data?.sell_price_avg) {
          this._renderCardEmpty('kaufland', 'Auf Kaufland nicht gefunden'); return;
        }
        this._results.kaufland = res.data;
        this._renderCard('kaufland', res.data);
      });
    }

    _renderCard(mkt, d) {
      const card = this._shadow.getElementById('fcCard-' + mkt);
      if (!card) return;
      card.classList.remove('skeleton', 'empty');

      // All values via textContent (XSS-safe)
      const set = (key, val) => {
        const el = card.querySelector('[data-fc="' + key + '"]');
        if (el) el.textContent = val;
      };
      const setClass = (key, cls) => {
        const el = card.querySelector('[data-fc="' + key + '"]');
        if (el) el.className = cls;
      };

      const verdict = (d.verdict || 'idle').toLowerCase();
      set('verdict', (d.verdict || '—').toUpperCase());
      setClass('verdict', 'fc-verdict ' + verdict);

      const margin = d.margin_pct;
      set('margin', pct(margin));
      setClass('margin', 'fc-margin' + (margin > 0 ? ' pos' : margin < 0 ? ' neg' : ''));

      const profit = d.profit_median ?? d.profit_avg;
      set('profit', eur(profit));
      setClass('profit', 'fc-kpi-val' + (profit > 0 ? ' pos' : profit < 0 ? ' neg' : ''));
      set('profit-sub', d.fees_median ? 'Geb ' + eur(d.fees_median) : '');

      const vk = d.sell_price_median ?? d.sell_price_avg;
      set('vk', eur(vk));
      set('vk-sub', d.sell_price_avg && d.sell_price_median && d.sell_price_avg !== d.sell_price_median
        ? 'ø ' + eur(d.sell_price_avg) : '');

      if (mkt === 'ebay') {
        set('kpi3-label', 'Verkäufe');
        set('kpi3', num(d.sales_30d));
        set('kpi3-sub', d.sales_30d ? '/30 Tage' : '');
        set('kpi4-label', 'Tage');
        set('kpi4', d.days_to_cash != null ? num(Math.round(d.days_to_cash)) : '—');
        set('kpi4-sub', d.days_to_cash != null ? 'bis Verkauf' : '');
      } else if (mkt === 'amazon') {
        // BSR drops = sales indicator from Keepa
        const sales = d.sales_30d ?? d.bsr_drops_30d;
        set('kpi3-label', 'Verkäufe');
        set('kpi3', num(sales));
        set('kpi3-sub', d.bsr_drops_30d != null
          ? 'aus BSR-Drops'
          : (d.sales_30d ? '/30 Tage' : ''));
        set('kpi4-label', 'BSR');
        set('kpi4', d.bsr_rank ? '#' + num(d.bsr_rank) : '—');
        set('kpi4-sub', d.fba_fee ? 'FBA ' + eur(d.fba_fee) : '');
      } else if (mkt === 'kaufland') {
        set('kpi3-label', 'Angebote');
        set('kpi3', num(d.offers_count));
        set('kpi3-sub', d.bestseller ? 'Bestseller' : '');
        set('kpi4-label', 'Score');
        set('kpi4', d.score != null ? num(d.score) : '—');
        set('kpi4-sub', d.label || '');
      }

      // Open URL
      const openLink = card.querySelector('[data-fc="open-url"]');
      if (openLink) {
        const id = mkt === 'amazon' ? this._currentAsin : this._currentEan;
        const urls = {
          ebay:     'https://www.ebay.de/sch/i.html?_nkw=' + encodeURIComponent(id) + '&LH_Sold=1&LH_Complete=1',
          amazon:   'https://www.amazon.de/dp/' + encodeURIComponent(id),
          kaufland: d.product_url || ('https://www.kaufland.de/s/?search_value=' + encodeURIComponent(id)),
        };
        openLink.href = urls[mkt] || '#';
      }

      this._renderCardDetails(card, mkt, d);
    }

    _renderCardDetails(card, mkt, d) {
      const details = card.querySelector('[data-fc="details"]');
      if (!details) return;
      // Build detail rows safely via DOM API (no innerHTML for dynamic content)
      details.replaceChildren();

      const profit = d.profit_median ?? d.profit_avg;
      const vk = d.sell_price_median ?? d.sell_price_avg;
      const rows = [];

      rows.push(['Verkaufspreis', eur(vk), '']);
      if (d.fees_median) rows.push(['Gebühr (' + ((d.fee_rate || 0) * 100).toFixed(1) + '%)', eur(d.fees_median), '']);
      if (d.fee_fixed) rows.push(['Fixed Fee', eur(d.fee_fixed), '']);
      if (d.fba_fee) rows.push(['FBA-Gebühr', eur(d.fba_fee), '']);
      if (this._lastEk) rows.push(['Einkauf', eur(this._lastEk), '']);
      rows.push(['Profit', eur(profit), profit > 0 ? 'profit-pos' : profit < 0 ? 'profit-neg' : '']);

      if (mkt === 'amazon' && d.bsr_drops_30d != null) {
        rows.push(['BSR-Drops 30 Tage', num(d.bsr_drops_30d) + ' (≈ Verkäufe)', '']);
      }
      if (mkt === 'amazon' && d.buy_box_price) {
        rows.push(['Buy Box', eur(d.buy_box_price), '']);
      }
      if (mkt === 'kaufland' && d.best_seller_name) {
        rows.push(['Bester Verkäufer', d.best_seller_name, '']);
      }

      for (const [label, val, valCls] of rows) {
        const row = document.createElement('div');
        row.className = 'fc-detail-row';
        const lbl = document.createElement('span');
        lbl.className = 'fc-detail-label';
        lbl.textContent = label;
        const v = document.createElement('span');
        v.className = 'fc-detail-val' + (valCls ? ' ' + valCls : '');
        v.textContent = val;
        row.appendChild(lbl);
        row.appendChild(v);
        details.appendChild(row);
      }
    }

    _renderCardEmpty(mkt, msg) {
      const card = this._shadow.getElementById('fcCard-' + mkt);
      if (!card) return;
      card.classList.remove('skeleton');
      card.classList.add('empty');
      const body = card.querySelector('.fc-card-body');
      if (body) {
        // Build empty state via DOM API (XSS-safe)
        body.replaceChildren();
        const m = document.createElement('div');
        m.className = 'fc-empty-msg';
        m.textContent = msg;
        const btn = document.createElement('button');
        btn.className = 'fc-empty-action';
        btn.textContent = 'Neu prüfen';
        btn.addEventListener('click', () => {
          if (this._currentEan) this.probe(this._currentEan);
        });
        body.appendChild(m);
        body.appendChild(btn);
      }
      const verdictEl = card.querySelector('[data-fc="verdict"]');
      if (verdictEl) { verdictEl.textContent = '—'; verdictEl.className = 'fc-verdict idle'; }
      const marginEl = card.querySelector('[data-fc="margin"]');
      if (marginEl) { marginEl.textContent = '—'; marginEl.className = 'fc-margin'; }
    }

    _renderCardError(mkt, msg) { this._renderCardEmpty(mkt, '⚠ ' + msg); }
  }

  // customElements may not be available at document_start; retry with backoff.
  // Also handles cases where the page or another extension messes with the registry.
  (function _define(retries) {
    if (typeof customElements !== 'undefined' && customElements) {
      try {
        if (!customElements.get('flipcheck-panel')) {
          customElements.define('flipcheck-panel', FlipcheckPanel);
          console.log('[FC] flipcheck-panel registered (v7)');
        }
        return;
      } catch (e) {
        console.warn('[FC] customElements.define failed:', e?.message);
      }
    }
    if (retries > 0) setTimeout(() => _define(retries - 1), 50);
  })(30);

  // esc helper retained for future use
  void esc;
})();
