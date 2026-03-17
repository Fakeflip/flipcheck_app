/* Flipcheck Extension — Sidebar Panel v6 (Full-Height Sidebar Redesign)
 * Docked right-side sidebar: full viewport height, scrollable body,
 * fixed verdict footer, inline chart + accordion details, settings overlay.
 */

(function () {
  if (window._fcPanelDef) return;
  window._fcPanelDef = true;

  // ── CSS ──────────────────────────────────────────────────────────────────
  const PANEL_CSS = `
    :host {
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      height: 100vh !important;
      width: auto !important;
      bottom: auto !important;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      display: block !important;
      pointer-events: none !important;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    button, input, select { font-family: inherit; }
    input[type=number] { -moz-appearance: textfield; }
    input[type=number]::-webkit-inner-spin-button,
    input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }

    /* ══ SIDEBAR SHELL ══ */
    .fc-wrap {
      width: 380px;
      min-width: 260px;
      max-width: 640px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: #09090D;
      border-left: 1px solid #1A1A26;
      box-shadow: -8px 0 32px rgba(0,0,0,.7), -1px 0 0 rgba(99,102,241,.08);
      overflow: hidden;
      position: relative;
      pointer-events: auto;
    }

    /* ══ RESIZE HANDLE ══ */
    .fc-resizer {
      position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
      cursor: ew-resize; z-index: 20;
    }
    .fc-resizer:hover, .fc-resizer.dragging {
      background: linear-gradient(180deg, transparent 0%, #4F52C7 20%, #4F52C7 80%, transparent 100%);
      opacity: .6;
    }
    /* Bottom-docked: resizer becomes a top edge horizontal drag handle */
    :host([data-pos="bottom"]) .fc-resizer {
      left: 0; right: 0; top: 0; bottom: auto; width: auto; height: 4px;
      cursor: ns-resize;
      background: none;
    }
    :host([data-pos="bottom"]) .fc-resizer:hover,
    :host([data-pos="bottom"]) .fc-resizer.dragging {
      background: linear-gradient(90deg, transparent 0%, #4F52C7 20%, #4F52C7 80%, transparent 100%);
    }

    /* ══ HEADER ══ */
    .fc-header {
      flex-shrink: 0;
      background: #0D0D14;
      border-bottom: 1px solid #1A1A26;
      padding: 0;
    }
    .fc-hdr-top {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 12px 8px;
    }
    .fc-logo {
      font-size: 11px; font-weight: 800; color: #6366F1;
      letter-spacing: .07em; flex-shrink: 0;
    }
    .fc-market-row { display: flex; gap: 2px; flex: 1; }
    .fc-mkt-btn {
      padding: 3px 10px; border-radius: 5px; border: 1px solid transparent;
      background: transparent; color: #3D4559; font-size: 10px; font-weight: 700;
      letter-spacing: .03em; cursor: pointer; transition: all .15s;
    }
    .fc-mkt-btn:hover { color: #64748B; background: #181826; }
    .fc-mkt-btn.active {
      background: rgba(99,102,241,.14); border-color: rgba(99,102,241,.28); color: #818CF8;
    }
    .fc-hdr-btns { display: flex; gap: 2px; flex-shrink: 0; }
    .fc-btn-icon {
      background: none; border: none; color: #2E3447; cursor: pointer;
      font-size: 13px; line-height: 1; padding: 4px 5px; border-radius: 5px;
      transition: color .15s, background .15s;
    }
    .fc-btn-icon:hover { color: #94A3B8; background: #181826; }

    /* Product info bar */
    .fc-product-bar {
      padding: 0 12px 10px; display: none;
    }
    .fc-product-bar.visible { display: block; }
    .fc-product-img-row { display: flex; align-items: center; gap: 8px; }
    .fc-product-img {
      width: 40px; height: 40px; object-fit: contain; border-radius: 4px;
      background: #1A1A2E; flex-shrink: 0;
    }
    .fc-product-title {
      font-size: 11px; color: #64748B; line-height: 1.4;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-bottom: 2px; min-width: 0;
    }
    .fc-id-tag {
      font-size: 10px; font-family: 'SF Mono','Menlo','Roboto Mono',monospace;
      color: #2E3447; letter-spacing: .02em;
    }

    /* ══ SCROLLABLE BODY ══ */
    .fc-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px;
      scrollbar-width: thin;
      scrollbar-color: #1C1C28 transparent;
    }
    .fc-body::-webkit-scrollbar { width: 3px; }
    .fc-body::-webkit-scrollbar-track { background: transparent; }
    .fc-body::-webkit-scrollbar-thumb { background: #1C1C28; border-radius: 2px; }

    /* ══ VERDICT FOOTER (fixed at bottom) ══ */
    .fc-verdict-footer {
      flex-shrink: 0;
      background: #0D0D14;
      border-top: 1px solid #1A1A26;
      padding: 10px 12px;
      display: none;
    }
    .fc-verdict-footer.visible { display: block; }

    /* ══ SETTINGS OVERLAY ══ */
    .fc-settings-overlay {
      position: absolute; inset: 0; background: #09090D;
      z-index: 50; display: none; flex-direction: column;
      overflow-y: auto;
    }
    .fc-settings-overlay.open { display: flex; }
    .fc-set-overlay-hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid #1A1A26;
      font-size: 12px; font-weight: 700; color: #94A3B8; flex-shrink: 0;
      letter-spacing: .04em;
    }
    .fc-set-overlay-body { padding: 14px; flex: 1; }

    /* pane compat shims — hidden, kept for JS compat */
    .fc-pane { display: none !important; }
    .fc-tabs { display: none !important; }

    /* ── CHECK PANE ── */
    .fc-mode-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .fc-mode-lbl {
      font-size: 9px; color: #2E3447; font-weight: 600;
      letter-spacing: .07em; text-transform: uppercase; flex-shrink: 0;
    }
    .fc-mode-pills { display: flex; gap: 2px; }
    .fc-mode-pill {
      padding: 2px 7px; border-radius: 4px; border: 1px solid transparent;
      background: transparent; color: #2E3447; font-size: 9px; font-weight: 700;
      cursor: pointer; transition: all .15s; letter-spacing: .03em;
    }
    .fc-mode-pill:hover { color: #4B5568; }
    .fc-mode-pill.active { background: #181826; border-color: #252538; color: #94A3B8; }

    .fc-ek-row { display: flex; gap: 6px; margin-bottom: 8px; align-items: stretch; }
    .fc-ek-wrap { flex: 1; position: relative; display: flex; align-items: center; }
    .fc-ek-prefix {
      position: absolute; left: 9px; color: #3D4559; font-size: 12px;
      font-weight: 600; pointer-events: none; z-index: 1;
    }
    .fc-ek-inp {
      width: 100%; background: #111119; border: 1px solid #1C1C28;
      border-radius: 7px; color: #F1F5F9; font-size: 13px; font-weight: 500;
      padding: 7px 9px 7px 22px; outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    .fc-ek-inp::placeholder { color: #202030; }
    .fc-ek-inp:focus { border-color: #4F52C7; box-shadow: 0 0 0 3px rgba(99,102,241,.11); }
    .fc-ek-inp.autofilled { border-color: #059669; box-shadow: 0 0 0 3px rgba(16,185,129,.09); }
    .fc-check-btn {
      background: #6366F1; color: #fff; border: none; border-radius: 7px;
      font-size: 14px; font-weight: 700; padding: 7px 13px; cursor: pointer;
      transition: background .15s, transform .1s; white-space: nowrap; flex-shrink: 0;
    }
    .fc-check-btn:hover { background: #5355CF; }
    .fc-check-btn:active { transform: scale(.95); }
    .fc-check-btn:disabled { opacity: .4; cursor: not-allowed; }

    .fc-prep-row { display: none; gap: 6px; margin-bottom: 8px; align-items: center; }
    .fc-prep-row.open { display: flex; }
    .fc-prep-wrap { flex: 1; position: relative; display: flex; align-items: center; }
    .fc-prep-inp {
      width: 100%; background: #111119; border: 1px solid #1C1C28;
      border-radius: 7px; color: #F1F5F9; font-size: 12px;
      padding: 6px 8px 6px 22px; outline: none; transition: border-color .15s;
    }
    .fc-prep-inp::placeholder { color: #202030; }
    .fc-prep-inp:focus { border-color: #4F52C7; }
    .fc-prep-lbl { font-size: 9px; color: #2E3447; white-space: nowrap; line-height: 1.3; max-width: 48px; text-align: right; flex-shrink: 0; }

    /* ── STATES ── */
    .fc-state { display: none; }
    .fc-state.active { display: block; }

    .fc-idle { text-align: center; padding: 16px 0 10px; color: #252535; font-size: 11px; line-height: 1.6; }

    /* Skeleton loader */
    @keyframes fc-pulse { 0%,100%{opacity:.35} 50%{opacity:.65} }
    @keyframes fc-spin  { to{transform:rotate(360deg)} }
    .fc-loading-wrap { padding: 4px 0 6px; }
    .fc-loading-top {
      display: flex; align-items: center; gap: 8px;
      color: #2E3447; font-size: 11px; margin-bottom: 12px;
    }
    .fc-loading-top::before {
      content: ''; display: block; width: 13px; height: 13px;
      border: 2px solid #1C1C28; border-top-color: #6366F1;
      border-radius: 50%; animation: fc-spin .7s linear infinite; flex-shrink: 0;
    }
    .fc-skel { height: 7px; border-radius: 4px; background: #181826; animation: fc-pulse 1.5s ease-in-out infinite; margin-bottom: 8px; }
    .fc-skel.s60 { width: 60%; }
    .fc-skel.s80 { width: 80%; }
    .fc-skel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 8px; }
    .fc-skel-cell { height: 52px; border-radius: 8px; background: #181826; animation: fc-pulse 1.5s ease-in-out infinite; }

    .fc-no-ean { text-align: center; padding: 14px 4px 8px; color: #2E3447; font-size: 11px; line-height: 1.6; }
    .fc-no-ean strong { color: #3D4559; display: block; margin-bottom: 4px; font-size: 12px; }

    .fc-error-wrap { text-align: center; padding: 14px 0 8px; }
    .fc-error-icon { font-size: 20px; margin-bottom: 7px; }
    .fc-error-msg { color: #EF4444; font-size: 11px; margin-bottom: 11px; line-height: 1.5; }
    .fc-retry-btn {
      background: #181826; border: 1px solid #252538; border-radius: 6px;
      color: #4B5568; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 5px 16px; transition: border-color .15s, color .15s;
    }
    .fc-retry-btn:hover { border-color: #6366F1; color: #E2E8F0; }

    .fc-scan-btn {
      display: block; width: 100%; margin-top: 8px;
      background: #111119; border: 1px dashed #1C1C28; border-radius: 7px;
      color: #2E3447; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 7px 0; transition: border-color .15s, color .15s;
    }
    .fc-scan-btn:hover:not(:disabled) { border-color: #6366F1; color: #64748B; }
    .fc-scan-btn:disabled { opacity: .35; cursor: not-allowed; }

    /* ── RESULT STATE ── */
    .fc-verdict-card {
      border-radius: 11px; padding: 12px 14px; margin-bottom: 8px;
      display: flex; align-items: center; gap: 10px; border: 1px solid transparent;
    }
    .fc-verdict-badge { font-size: 13px; font-weight: 800; letter-spacing: .07em; flex-shrink: 0; }
    .fc-verdict-right { flex: 1; text-align: right; }
    .fc-verdict-profit { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
    .fc-verdict-sub { font-size: 9px; font-weight: 500; opacity: .55; display: block; margin-top: 2px; }

    /* Margin progress bar */
    .fc-mbar-wrap { display: flex; align-items: center; gap: 8px; margin-bottom: 0; }
    .fc-mbar-bg { flex: 1; height: 4px; background: #181826; border-radius: 2px; overflow: hidden; }
    .fc-mbar-fill { height: 100%; border-radius: 2px; transition: width .5s cubic-bezier(.4,0,.2,1); }
    .fc-mbar-pct { font-size: 11px; font-weight: 700; color: #3D4559; flex-shrink: 0; min-width: 36px; text-align: right; font-variant-numeric: tabular-nums; }

    .fc-title { font-size: 10px; color: #374151; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; display: none; }
    .fc-id-row { display: flex; gap: 5px; margin-bottom: 9px; flex-wrap: wrap; }
    .fc-id-row:empty { display: none; }
    .fc-id-chip {
      display: inline-flex; align-items: center; gap: 4px; font-size: 9px;
      font-family: 'SF Mono','Roboto Mono',monospace;
      background: #111119; border: 1px solid #1C1C28; border-radius: 5px;
      padding: 3px 7px; color: #4B5568; cursor: pointer;
      transition: border-color .15s, background .15s, color .15s; letter-spacing: .01em;
    }
    .fc-id-chip:hover { background: #181826; border-color: #4F52C7; color: #94A3B8; }
    .fc-id-chip-lbl { color: #6366F1; font-weight: 700; font-size: 8px; letter-spacing: .07em; text-transform: uppercase; }

    /* KPI grid */
    .fc-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 7px; }
    .fc-kpi {
      background: #111119; border: 1px solid #181826; border-radius: 8px;
      padding: 7px 9px; transition: border-color .15s;
    }
    .fc-kpi:hover { border-color: #222235; }
    .fc-kpi-v { display: block; font-size: 14px; font-weight: 700; color: #E2E8F0; font-variant-numeric: tabular-nums; line-height: 1.15; }
    .fc-kpi-l { display: block; font-size: 9px; color: #2E3447; margin-top: 2px; font-weight: 500; }
    .fc-kpi-v.green  { color: #22C55E; }
    .fc-kpi-v.red    { color: #EF4444; }
    .fc-kpi-v.yellow { color: #F59E0B; }

    /* Sales row (full width) */
    .fc-sales-row {
      background: #111119; border: 1px solid #181826; border-radius: 8px;
      padding: 7px 9px; margin-bottom: 8px;
    }
    .fc-sales-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
    .fc-sales-v { font-size: 13px; font-weight: 700; color: #E2E8F0; font-variant-numeric: tabular-nums; }
    .fc-sales-l { font-size: 9px; color: #2E3447; font-weight: 500; }
    .fc-vel-bg { height: 3px; background: #1C1C28; border-radius: 2px; overflow: hidden; }
    .fc-vel-fill { height: 100%; border-radius: 2px; transition: width .5s ease; }

    /* Actions */
    .fc-actions { display: flex; gap: 5px; }
    .fc-action-btn {
      flex: 1; background: #111119; color: #4B5568; border: 1px solid #1C1C28;
      border-radius: 7px; font-size: 11px; font-weight: 600; padding: 6px 7px;
      cursor: pointer; transition: all .15s; text-align: center; white-space: nowrap;
    }
    .fc-action-btn:hover { border-color: #4F52C7; color: #A5B4FC; background: rgba(99,102,241,.07); }
    .fc-action-btn.saved { border-color: #059669; color: #34D399; cursor: default; background: rgba(16,185,129,.06); }

    /* Price-compare links row */
    .fc-compare-row { display: flex; gap: 5px; margin-top: 5px; }
    .fc-cmp-btn {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
      background: #0A0A12; color: #3D4559; border: 1px solid #16161F;
      border-radius: 7px; font-size: 10px; font-weight: 700; padding: 5px 4px;
      cursor: pointer; transition: all .15s; text-decoration: none; white-space: nowrap;
      letter-spacing: .02em;
    }
    .fc-cmp-btn:hover { border-color: rgba(99,102,241,.3); color: #818CF8; background: rgba(99,102,241,.06); }
    .fc-cmp-btn .fc-cmp-dot {
      width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    }

    /* Alert form */
    .fc-alert-form {
      display: none; margin-top: 7px; padding: 10px;
      background: #111119; border: 1px solid #1C1C28; border-radius: 8px;
    }
    .fc-alert-form.open { display: block; }
    .fc-alert-lbl { display: block; font-size: 9px; color: #2E3447; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 6px; }
    .fc-alert-row { display: flex; gap: 5px; }
    .fc-alert-inp {
      flex: 1; background: #0E0E14; border: 1px solid #1C1C28; border-radius: 6px;
      color: #F1F5F9; font-size: 12px; padding: 5px 9px; outline: none; transition: border-color .15s;
    }
    .fc-alert-inp:focus { border-color: #4F52C7; }
    .fc-alert-inp::placeholder { color: #1C1C28; }
    .fc-alert-submit {
      background: #6366F1; border: none; border-radius: 6px; color: #fff;
      cursor: pointer; font-size: 11px; font-weight: 700; padding: 5px 11px;
      white-space: nowrap; transition: background .15s;
    }
    .fc-alert-submit:hover { background: #5355CF; }
    .fc-alert-fb { display: none; font-size: 10px; margin-top: 5px; }

    .fc-cached-note { font-size: 9px; color: #1C1C28; text-align: center; margin-top: 7px; min-height: 11px; letter-spacing: .02em; }

    /* ══ INLINE SECTIONS (visible after result) ══ */
    .fc-section { display: none; margin-top: 10px; }
    .fc-section.visible { display: block; }
    .fc-section-hdr {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }
    .fc-section-title {
      font-size: 9px; font-weight: 700; color: #2E3447;
      text-transform: uppercase; letter-spacing: .08em;
    }

    /* KPI grid — 2x2 with bigger cells in sidebar */
    .fc-kpis {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 6px; margin-bottom: 0;
    }
    .fc-kpi {
      background: #111119; border: 1px solid #181826; border-radius: 10px;
      padding: 10px 12px; transition: border-color .15s;
    }
    .fc-kpi:hover { border-color: #222235; }
    .fc-kpi-v {
      display: block; font-size: 16px; font-weight: 700;
      color: #E2E8F0; font-variant-numeric: tabular-nums; line-height: 1.2;
    }
    .fc-kpi-l {
      display: block; font-size: 9px; color: #2E3447;
      margin-top: 3px; font-weight: 500;
    }

    /* Sales row full-width */
    .fc-sales-row {
      background: #111119; border: 1px solid #181826; border-radius: 10px;
      padding: 10px 12px; margin-top: 6px;
    }
    .fc-sales-top {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
    }
    .fc-sales-v { font-size: 15px; font-weight: 700; color: #E2E8F0; font-variant-numeric: tabular-nums; }
    .fc-sales-l { font-size: 9px; color: #2E3447; font-weight: 500; }
    .fc-vel-bg { height: 3px; background: #1C1C28; border-radius: 2px; overflow: hidden; }
    .fc-vel-fill { height: 100%; border-radius: 2px; transition: width .5s ease; }

    /* ══ ACCORDION (Details) ══ */
    .fc-acc {
      border: 1px solid #181826; border-radius: 10px;
      overflow: hidden; margin-top: 6px;
    }
    .fc-acc-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 12px; background: #111119; cursor: pointer; width: 100%;
      border: none; text-align: left;
      transition: background .15s;
    }
    .fc-acc-head:hover { background: #141420; }
    .fc-acc-label {
      font-size: 10px; font-weight: 600; color: #4B5568; letter-spacing: .02em;
    }
    .fc-acc-arrow {
      font-size: 10px; color: #2E3447; transition: transform .2s ease;
      flex-shrink: 0; line-height: 1;
    }
    .fc-acc.open .fc-acc-arrow { transform: rotate(90deg); }
    .fc-acc-body {
      display: none; padding: 10px 12px;
      border-top: 1px solid #1A1A26; background: #0E0E15;
    }
    .fc-acc.open .fc-acc-body { display: block; }

    /* ══ ACTION BUTTONS (in body) ══ */
    .fc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 10px; }
    .fc-action-btn {
      background: #111119; color: #4B5568; border: 1px solid #1C1C28;
      border-radius: 8px; font-size: 11px; font-weight: 600; padding: 8px 7px;
      cursor: pointer; transition: all .15s; text-align: center; white-space: nowrap;
    }
    .fc-action-btn:hover { border-color: #4F52C7; color: #A5B4FC; background: rgba(99,102,241,.07); }
    .fc-action-btn.saved { border-color: #059669; color: #34D399; cursor: default; background: rgba(16,185,129,.06); }

    /* Compare links */
    .fc-compare-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px; }
    .fc-cmp-btn {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      background: #0A0A12; color: #3D4559; border: 1px solid #16161F;
      border-radius: 8px; font-size: 10px; font-weight: 700; padding: 7px 4px;
      cursor: pointer; transition: all .15s; text-decoration: none; white-space: nowrap;
    }
    .fc-cmp-btn:hover { border-color: rgba(99,102,241,.3); color: #818CF8; background: rgba(99,102,241,.06); }
    .fc-cmp-btn .fc-cmp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    /* Alert form */
    .fc-alert-form {
      display: none; margin-top: 8px; padding: 11px;
      background: #111119; border: 1px solid #1C1C28; border-radius: 9px;
    }
    .fc-alert-form.open { display: block; }
    .fc-alert-lbl { display: block; font-size: 9px; color: #2E3447; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 7px; }
    .fc-alert-row { display: flex; gap: 6px; }
    .fc-alert-inp {
      flex: 1; background: #0E0E14; border: 1px solid #1C1C28; border-radius: 6px;
      color: #F1F5F9; font-size: 12px; padding: 6px 10px; outline: none; transition: border-color .15s;
    }
    .fc-alert-inp:focus { border-color: #4F52C7; }
    .fc-alert-inp::placeholder { color: #1C1C28; }
    .fc-alert-submit {
      background: #6366F1; border: none; border-radius: 6px; color: #fff;
      cursor: pointer; font-size: 11px; font-weight: 700; padding: 6px 12px;
      white-space: nowrap; transition: background .15s;
    }
    .fc-alert-submit:hover { background: #5355CF; }
    .fc-alert-fb { display: none; font-size: 10px; margin-top: 6px; }

    /* Upgrade */
    .fc-upgrade-wrap { text-align: center; padding: 30px 12px; }
    .fc-upgrade-icon { font-size: 30px; margin-bottom: 10px; }
    .fc-upgrade-title { font-size: 14px; font-weight: 700; color: #E2E8F0; margin-bottom: 5px; }
    .fc-upgrade-text  { font-size: 11px; color: #2E3447; margin-bottom: 16px; line-height: 1.6; }
    .fc-upgrade-btn {
      display: inline-block; background: #6366F1; color: #fff; border-radius: 8px;
      font-size: 12px; font-weight: 700; padding: 9px 22px; text-decoration: none; transition: background .15s;
    }
    .fc-upgrade-btn:hover { background: #5355CF; }

    /* Upgrade */
    .fc-upgrade-wrap { text-align: center; padding: 18px 8px 12px; }
    .fc-upgrade-icon { font-size: 26px; margin-bottom: 8px; }
    .fc-upgrade-title { font-size: 13px; font-weight: 700; color: #E2E8F0; margin-bottom: 4px; }
    .fc-upgrade-text  { font-size: 11px; color: #2E3447; margin-bottom: 14px; line-height: 1.6; }
    .fc-upgrade-btn {
      display: inline-block; background: #6366F1; color: #fff; border-radius: 7px;
      font-size: 12px; font-weight: 700; padding: 8px 20px; text-decoration: none; transition: background .15s;
    }
    .fc-upgrade-btn:hover { background: #5355CF; }

    /* ══ CHART PANE ══ */
    .fc-chart-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
    .fc-chart-title { font-size: 9px; font-weight: 700; color: #2E3447; text-transform: uppercase; letter-spacing: .08em; }
    .fc-chart-ranges { display: flex; gap: 3px; }
    .fc-chart-rbtn {
      background: transparent; border: 1px solid transparent; border-radius: 5px;
      color: #2E3447; cursor: pointer; font-size: 9.5px; font-weight: 600;
      padding: 3px 8px; transition: all .15s;
    }
    .fc-chart-rbtn:hover { color: #4B5568; }
    .fc-chart-rbtn.active { background: #181826; border-color: #252538; color: #94A3B8; }

    /* Canvas container */
    .fc-chart-wrap {
      position: relative; height: 200px; margin-bottom: 9px;
      border-radius: 9px; overflow: hidden; background: #0A0A10;
      border: 1px solid #181826;
    }
    .fc-chart-canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
    .fc-chart-empty {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; color: #1C1C28; font-size: 11px; pointer-events: none;
    }

    /* Hover tooltip */
    .fc-chart-tip {
      position: absolute; top: 8px; pointer-events: none; display: none;
      background: rgba(10,10,16,.93); border: 1px solid #252538;
      border-radius: 7px; padding: 6px 9px; backdrop-filter: blur(6px);
      z-index: 10; white-space: nowrap;
    }
    .fc-chart-tip-date { font-size: 9px; color: #4B5568; margin-bottom: 2px; letter-spacing: .02em; }
    .fc-chart-tip-price { font-size: 13px; font-weight: 700; color: #F1F5F9; font-variant-numeric: tabular-nums; }
    .fc-chart-tip-lbl { font-size: 8px; color: #374151; margin-top: 1px; }
    .fc-chart-tip-sep { height: 1px; background: #1E1E2E; margin: 4px 0; }
    .fc-chart-tip-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 9px; }
    .fc-chart-tip-row-lbl { color: #4B5568; }
    .fc-chart-tip-row-val { font-weight: 700; font-variant-numeric: tabular-nums; }

    /* Legend */
    .fc-chart-legend { display: none; gap: 10px; margin-bottom: 8px; }
    .fc-chart-legend.visible { display: flex; }
    .fc-legend-item { display: flex; align-items: center; gap: 5px; font-size: 9px; color: #374151; font-weight: 600; }
    .fc-legend-line { width: 12px; height: 2px; border-radius: 1px; flex-shrink: 0; }

    /* Stats row */
    .fc-chart-stats { display: none; grid-template-columns: repeat(4,1fr); gap: 4px; }
    .fc-chart-stats.visible { display: grid; }
    .fc-chart-stat { background: #111119; border: 1px solid #181826; border-radius: 7px; padding: 5px 6px; text-align: center; }
    .fc-chart-stat-v { display: block; font-size: 10.5px; font-weight: 700; color: #E2E8F0; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .fc-chart-stat-l { display: block; font-size: 8.5px; color: #2E3447; margin-top: 2px; font-weight: 500; }
    .fc-trend-up   { color: #22C55E !important; }
    .fc-trend-down { color: #EF4444 !important; }

    /* ══ DETAILS PANE ══ */
    .fc-det-sec { margin-bottom: 11px; }
    .fc-det-title { font-size: 9px; font-weight: 700; color: #2E3447; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 7px; }
    .fc-det-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 9px; }
    .fc-det-cell { background: #111119; border: 1px solid #181826; border-radius: 7px; padding: 6px 8px; }
    .fc-det-v { display: block; font-size: 12px; font-weight: 700; color: #E2E8F0; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .fc-det-l { display: block; font-size: 8.5px; color: #2E3447; margin-top: 2px; font-weight: 500; }
    .fc-det-v.green  { color: #22C55E; }
    .fc-det-v.yellow { color: #F59E0B; }
    .fc-det-sep { height: 1px; background: #181826; margin: 10px 0; }
    .fc-intl-chip { display: inline-flex; align-items: center; gap: 3px; background: #111119; border: 1px solid #1A1A26; border-radius: 5px; padding: 3px 7px; font-size: 10px; font-weight: 600; color: #64748B; }
    .fc-intl-chip .fc-intl-flag { font-size: 12px; }
    .fc-intl-chip .fc-intl-price { color: #94A3B8; }
    .fc-det-inp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
    .fc-det-inp-label { font-size: 10px; color: #4B5568; flex-shrink: 0; min-width: 90px; font-weight: 500; }
    .fc-det-inp {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 6px;
      color: #F1F5F9; font-size: 12px; padding: 5px 8px; outline: none; transition: border-color .15s;
    }
    .fc-det-inp:focus { border-color: #4F52C7; }
    .fc-det-inp::placeholder { color: #1C1C28; }
    .fc-det-toggle { display: flex; gap: 3px; flex: 1; }
    .fc-det-tog-btn {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 5px;
      color: #2E3447; cursor: pointer; font-size: 10px; font-weight: 600;
      padding: 5px 0; text-align: center; transition: all .15s;
    }
    .fc-det-tog-btn.active { background: rgba(99,102,241,.13); border-color: rgba(99,102,241,.28); color: #818CF8; }
    .fc-det-recalc {
      width: 100%; background: #111119; border: 1px solid #1C1C28; border-radius: 7px;
      color: #3D4559; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 7px 0; transition: border-color .15s, color .15s; margin-top: 4px;
    }
    .fc-det-recalc:hover { border-color: #4F52C7; color: #E2E8F0; }
    .fc-det-empty { color: #1C1C28; font-size: 11px; text-align: center; padding: 30px 0; }

    /* ══ SETTINGS PANE ══ */
    .fc-set-sec { margin-bottom: 13px; }
    .fc-set-title { font-size: 9px; font-weight: 700; color: #2E3447; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .fc-set-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
    .fc-set-label { font-size: 10px; color: #4B5568; flex-shrink: 0; min-width: 76px; font-weight: 500; }
    .fc-set-inp {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 6px;
      color: #F1F5F9; font-size: 12px; padding: 5px 8px; outline: none; transition: border-color .15s;
    }
    .fc-set-inp:focus { border-color: #4F52C7; }
    .fc-set-inp::placeholder { color: #1C1C28; }
    .fc-set-select {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 6px;
      color: #F1F5F9; font-size: 11px; padding: 5px 24px 5px 8px; outline: none;
      appearance: none; -webkit-appearance: none; cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%232E3447'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
      transition: border-color .15s;
    }
    .fc-set-select:focus { border-color: #4F52C7; }
    .fc-set-select option { background: #111119; color: #F1F5F9; }
    .fc-set-select optgroup { color: #2E3447; }
    .fc-set-mkt-row { display: flex; gap: 3px; flex: 1; }
    .fc-set-mkt-btn {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 6px;
      color: #2E3447; cursor: pointer; font-size: 10px; font-weight: 600;
      padding: 5px 0; text-align: center; transition: all .15s;
    }
    .fc-set-mkt-btn.active { background: rgba(99,102,241,.13); border-color: rgba(99,102,241,.28); color: #818CF8; }
    .fc-set-saved { font-size: 9px; color: #22C55E; text-align: center; opacity: 0; transition: opacity .3s; margin-top: 4px; }
    .fc-set-saved.visible { opacity: 1; }
    /* Position selector */
    .fc-pos-btns { display: flex; gap: 3px; flex: 1; }
    .fc-pos-btn {
      flex: 1; background: #111119; border: 1px solid #1C1C28; border-radius: 6px;
      color: #2E3447; cursor: pointer; font-size: 10px; font-weight: 700;
      padding: 5px 0; text-align: center; transition: all .15s; letter-spacing: .03em;
    }
    .fc-pos-btn:hover { color: #64748B; background: #181826; }
    .fc-pos-btn.active { background: rgba(99,102,241,.13); border-color: rgba(99,102,241,.28); color: #818CF8; }
  `;

  // ── HTML ─────────────────────────────────────────────────────────────────
  const PANEL_HTML = `
    <style>${PANEL_CSS}</style>
    <div class="fc-wrap">

      <!-- ── LEFT RESIZE HANDLE ── -->
      <div class="fc-resizer" id="fcResizer"></div>

      <!-- ── HEADER ── -->
      <div class="fc-header" id="fcHeader">
        <div class="fc-hdr-top">
          <span class="fc-logo">▲ FC</span>
          <div class="fc-market-row">
            <button class="fc-mkt-btn active" data-market="ebay">eBay</button>
            <button class="fc-mkt-btn" data-market="amazon">Amazon</button>
            <button class="fc-mkt-btn" data-market="kaufland">Kaufland</button>
          </div>
          <div class="fc-hdr-btns">
            <button class="fc-btn-icon" id="fcSettingsBtn" title="Einstellungen">⚙</button>
            <button class="fc-btn-icon" id="fcCloseBtn" title="Schließen">✕</button>
          </div>
        </div>
        <!-- Product info strip (visible after result) -->
        <div class="fc-product-bar" id="fcProductBar">
          <div class="fc-product-img-row">
            <img class="fc-product-img" id="fcProductImg" src="" alt="" style="display:none">
            <div class="fc-product-title" id="fcTitle"></div>
          </div>
          <span class="fc-id-tag" id="fcIdTag"></span>
        </div>
      </div>

      <!-- ── SCROLLABLE BODY ── -->
      <div class="fc-body">

        <!-- Mode + EK Input (always visible) -->
        <div class="fc-mode-row">
          <span class="fc-mode-lbl">Modus</span>
          <div class="fc-mode-pills">
            <button class="fc-mode-pill" data-mode="low" title="Günstigstes Angebot">Min</button>
            <button class="fc-mode-pill active" data-mode="mid" title="Median-Preis">Med</button>
            <button class="fc-mode-pill" data-mode="high" title="Höchster Preis">Max</button>
          </div>
        </div>
        <div class="fc-ek-row">
          <div class="fc-ek-wrap">
            <span class="fc-ek-prefix">€</span>
            <input class="fc-ek-inp" id="fcEkInp" type="number" step="0.01" min="0" placeholder="Einkaufspreis" />
          </div>
          <button class="fc-check-btn" id="fcCheckBtn">→</button>
        </div>
        <div class="fc-prep-row" id="fcPrepRow">
          <div class="fc-prep-wrap">
            <span class="fc-ek-prefix">€</span>
            <input class="fc-prep-inp" id="fcPrepInp" type="number" step="0.01" min="0" placeholder="PREP / Stk." />
          </div>
          <span class="fc-prep-lbl">Labeling/<br>Bagging</span>
        </div>

        <!-- ── STATES ── -->
        <div class="fc-state active" id="stIdle">
          <div class="fc-idle">EAN oder ASIN erkannt — Einkaufspreis eingeben und prüfen.</div>
        </div>
        <div class="fc-state" id="stLoading">
          <div class="fc-loading-wrap">
            <div class="fc-loading-top">Marktdaten werden geladen…</div>
            <div class="fc-skel s80"></div><div class="fc-skel s60"></div>
            <div class="fc-skel-grid">
              <div class="fc-skel-cell"></div><div class="fc-skel-cell"></div>
              <div class="fc-skel-cell"></div><div class="fc-skel-cell"></div>
            </div>
          </div>
        </div>
        <div class="fc-state" id="stResult">
          <!-- ID chips -->
          <div id="fcIdDisplay" class="fc-id-row"></div>
        </div>
        <div class="fc-state" id="stError">
          <div class="fc-error-wrap">
            <div class="fc-error-icon">⚠</div>
            <div class="fc-error-msg" id="fcErrorMsg">Backend nicht erreichbar.</div>
            <button class="fc-retry-btn" id="fcRetryBtn">↺ Erneut versuchen</button>
          </div>
        </div>
        <div class="fc-state" id="stNoEan">
          <div class="fc-no-ean">
            <strong>Kein EAN / ASIN erkannt</strong>
            Bitte oben manuell eingeben.
          </div>
          <button class="fc-scan-btn" id="fcScanBtn">🔍 Seite neu scannen</button>
        </div>
        <div class="fc-state" id="stPlanLimit">
          <div class="fc-upgrade-wrap">
            <div class="fc-upgrade-icon">🔒</div>
            <div class="fc-upgrade-title">Tageslimit erreicht</div>
            <div class="fc-upgrade-text">Dein tägliches Gratis-Kontingent ist aufgebraucht.</div>
            <a class="fc-upgrade-btn" id="fcUpgradeBtn" href="https://whop.com/flipcheck" target="_blank" rel="noopener">⚡ Upgrade auf PRO</a>
          </div>
        </div>
        <div class="fc-state" id="stProRequired">
          <div class="fc-upgrade-wrap">
            <div class="fc-upgrade-icon">▲</div>
            <div class="fc-upgrade-title">Flipcheck Pro</div>
            <div class="fc-upgrade-text">Für die Extension benötigst du einen aktiven Pro-Plan.</div>
            <a class="fc-upgrade-btn" href="https://joinflipcheck.app/account" target="_blank" rel="noopener">7 Tage gratis testen →</a>
          </div>
        </div>

        <!-- ── KPI SECTION (visible after result) ── -->
        <div class="fc-section" id="fcKpiSection">
          <div class="fc-kpis">
            <div class="fc-kpi">
              <span class="fc-kpi-v" id="kvVk">—</span>
              <span class="fc-kpi-l" id="kvVkLabel">Median VK</span>
            </div>
            <div class="fc-kpi">
              <span class="fc-kpi-v red" id="kvFee">—</span>
              <span class="fc-kpi-l" id="kvFeeLabel">eBay Gebühr</span>
            </div>
          </div>
          <div class="fc-sales-row">
            <div class="fc-sales-top">
              <span class="fc-sales-v" id="kvSales">—</span>
              <span class="fc-sales-l" id="kvSalesLabel">Verk./30d</span>
            </div>
            <div class="fc-vel-bg"><div class="fc-vel-fill" id="fcVelFill"></div></div>
          </div>
        </div>

        <!-- ── CHART SECTION (visible after result) ── -->
        <div class="fc-section" id="fcChartSection">
          <div class="fc-section-hdr">
            <span class="fc-section-title">Preisverlauf</span>
            <div class="fc-chart-ranges">
              <button class="fc-chart-rbtn active" data-days="30">30T</button>
              <button class="fc-chart-rbtn" data-days="90">90T</button>
              <button class="fc-chart-rbtn" data-days="365">1J</button>
            </div>
          </div>
          <div class="fc-chart-legend" id="fcChartLegend">
            <div class="fc-legend-item"><div class="fc-legend-line" style="background:#6366F1"></div><span id="legendPrimary">Median VK</span></div>
          </div>
          <div class="fc-chart-wrap">
            <canvas class="fc-chart-canvas" id="fcChartCanvas"></canvas>
            <div class="fc-chart-empty" id="fcChartEmpty">Noch keine Daten.</div>
            <div class="fc-chart-tip" id="fcChartTip">
              <div class="fc-chart-tip-date" id="fcChartTipDate"></div>
              <div class="fc-chart-tip-price" id="fcChartTipPrice"></div>
              <div class="fc-chart-tip-lbl" id="fcChartTipLbl"></div>
              <!-- BSR row (Amazon) -->
              <div class="fc-chart-tip-sep" id="fcChartTipBsrSep" style="display:none"></div>
              <div class="fc-chart-tip-row" id="fcChartTipBsrRow" style="display:none">
                <span class="fc-chart-tip-row-lbl">BSR</span>
                <span class="fc-chart-tip-row-val" id="fcChartTipBsr" style="color:#FBbf24"></span>
              </div>
              <!-- Volume row (eBay) -->
              <div class="fc-chart-tip-sep" id="fcChartTipQtySep" style="display:none"></div>
              <div class="fc-chart-tip-row" id="fcChartTipQtyRow" style="display:none">
                <span class="fc-chart-tip-row-lbl">Verk.</span>
                <span class="fc-chart-tip-row-val" id="fcChartTipQty" style="color:#818CF8"></span>
              </div>
            </div>
          </div>
          <div class="fc-chart-stats" id="fcChartStats">
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csMin">—</span><span class="fc-chart-stat-l">Min</span></div>
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csAvg">—</span><span class="fc-chart-stat-l">Ø</span></div>
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csMax">—</span><span class="fc-chart-stat-l">Max</span></div>
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csTrend">—</span><span class="fc-chart-stat-l">Trend</span></div>
          </div>
        </div>

        <!-- ── DETAILS ACCORDION (visible after result) ── -->
        <div class="fc-section" id="fcDetailsSection">

          <!-- eBay Accordion -->
          <div class="fc-acc" id="accEbay">
            <button class="fc-acc-head">
              <span class="fc-acc-label">eBay Details</span>
              <span class="fc-acc-arrow">›</span>
            </button>
            <div class="fc-acc-body">
              <div id="detEbay">
                <div class="fc-det-grid">
                  <div class="fc-det-cell"><span class="fc-det-v" id="deListings">—</span><span class="fc-det-l">Aktive Angebote</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="deDtc">—</span><span class="fc-det-l">Ø Tage bis Verk.</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="deBrowseAvg">—</span><span class="fc-det-l">Ø Listenpreis</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="deSales30d">—</span><span class="fc-det-l">Verk./30T (est.)</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="deSellAvg">—</span><span class="fc-det-l">Ø Verkaufspreis</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="deFeesMedian">—</span><span class="fc-det-l">eBay Gebühren</span></div>
                </div>
                <div class="fc-det-sep"></div>
                <div class="fc-det-inp-row">
                  <span class="fc-det-inp-label">Versand VK (€)</span>
                  <input class="fc-det-inp" id="deShipOut" type="number" step="0.01" min="0" placeholder="0.00" />
                </div>
                <button class="fc-det-recalc" id="deRecalcBtn">↺ Neu berechnen</button>
              </div>
            </div>
          </div>

          <!-- Amazon Accordion -->
          <div class="fc-acc" id="accAmazon" style="display:none">
            <button class="fc-acc-head">
              <span class="fc-acc-label">Amazon Details</span>
              <span class="fc-acc-arrow">›</span>
            </button>
            <div class="fc-acc-body">
              <div id="detAmazon">
                <div class="fc-det-grid">
                  <div class="fc-det-cell"><span class="fc-det-v" id="daBoxPrice">—</span><span class="fc-det-l">Buy Box aktuell</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daBoxAvg30">—</span><span class="fc-det-l">Ø Buy Box 30T</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daRefFee">—</span><span class="fc-det-l">Referral Fee</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daFbaFee">—</span><span class="fc-det-l">FBA Fee</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daClosingFee">—</span><span class="fc-det-l">Closing Fee</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daPrepFee">—</span><span class="fc-det-l">PREP Gebühr</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daOffers">—</span><span class="fc-det-l">Angebote (neu)</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daRank">—</span><span class="fc-det-l">Sales Rank</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daSales">—</span><span class="fc-det-l">Est. Verk./30d</span></div>
                  <div class="fc-det-cell"><span class="fc-det-v" id="daBsrDrops">—</span><span class="fc-det-l">BSR Drops/30d</span></div>
                  <div class="fc-det-cell" style="grid-column:1/-1"><span class="fc-det-v" id="daVariants">—</span><span class="fc-det-l">Varianten</span></div>
                </div>
                <!-- International prices row (hidden until data arrives) -->
                <div id="daIntlRow" style="display:none;padding:6px 0 2px;">
                  <div style="font-size:9px;color:#4B5563;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em;">Internationale Preise</div>
                  <div id="daIntlPrices" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
                </div>
                <div class="fc-det-sep"></div>
                <div class="fc-det-inp-row">
                  <span class="fc-det-inp-label">Methode</span>
                  <div class="fc-det-toggle">
                    <button class="fc-det-tog-btn active" data-method="fba">FBA</button>
                    <button class="fc-det-tog-btn" data-method="fbm">FBM</button>
                  </div>
                </div>
                <div class="fc-det-inp-row" id="daShipInRow" style="display:none">
                  <span class="fc-det-inp-label">Versand EK (€)</span>
                  <input class="fc-det-inp" id="daShipIn" type="number" step="0.01" min="0" placeholder="0.00" />
                </div>
                <div class="fc-det-inp-row">
                  <span class="fc-det-inp-label">Größe</span>
                  <select class="fc-det-inp" id="daSizeCategory" style="padding:3px 6px;font-size:11px;">
                    <option value="klein">Klein</option>
                    <option value="standard" selected>Standard</option>
                    <option value="uebergross">Übergroß</option>
                  </select>
                </div>
                <div class="fc-det-inp-row">
                  <span class="fc-det-inp-label">Lagerzeit (Mo.)</span>
                  <input class="fc-det-inp" id="daLagermonate" type="number" step="1" min="0" max="24" placeholder="1" value="1" />
                </div>
                <div class="fc-det-inp-row">
                  <span class="fc-det-inp-label" style="color:#94A3B8">Lagergebühr</span>
                  <span id="daLagerFeeDisplay" style="font-size:11px;color:#EF4444;font-weight:700;">—</span>
                </div>
                <button class="fc-det-recalc" id="daRecalcBtn">↺ Neu berechnen</button>
              </div>
            </div>
          </div>

        </div><!-- /fcDetailsSection -->

        <!-- ── ACTIONS (visible after result) ── -->
        <div class="fc-section" id="fcActionsSection">
          <div class="fc-actions">
            <button class="fc-action-btn" id="fcInvBtn">＋ Inventar</button>
            <button class="fc-action-btn" id="fcAlertBtn">🔔 Alarm</button>
          </div>
          <div class="fc-compare-row">
            <a class="fc-cmp-btn" id="fcIdealoBtn" href="#" target="_blank" rel="noopener">
              <span class="fc-cmp-dot" style="background:#E8780C"></span>idealo
            </a>
            <a class="fc-cmp-btn" id="fcGeizhalsBtn" href="#" target="_blank" rel="noopener">
              <span class="fc-cmp-dot" style="background:#E63B2A"></span>Geizhals
            </a>
          </div>
          <div class="fc-compare-row" id="fcMarketLinks" style="display:none">
            <a class="fc-cmp-btn" id="fcLinkEbay" href="#" target="_blank" rel="noopener" style="display:none">
              <span class="fc-cmp-dot" style="background:#E53238"></span>eBay
            </a>
            <a class="fc-cmp-btn" id="fcLinkAmazon" href="#" target="_blank" rel="noopener" style="display:none">
              <span class="fc-cmp-dot" style="background:#FF9900"></span>Amazon
            </a>
            <a class="fc-cmp-btn" id="fcLinkKaufland" href="#" target="_blank" rel="noopener" style="display:none">
              <span class="fc-cmp-dot" style="background:#E2001A"></span>Kaufland
            </a>
          </div>
          <div class="fc-alert-form" id="fcAlertForm">
            <span class="fc-alert-lbl">Zielpreis-Alarm</span>
            <div class="fc-alert-row">
              <input class="fc-alert-inp" id="fcAlertInp" type="number" step="0.01" min="0" placeholder="Zielpreis (€)" />
              <button class="fc-alert-submit" id="fcAlertSubmit">Setzen</button>
            </div>
            <div class="fc-alert-fb" id="fcAlertFb"></div>
          </div>
          <div class="fc-cached-note" id="fcCachedNote"></div>
        </div>

      </div><!-- /fc-body -->

      <!-- ── VERDICT FOOTER (fixed at bottom) ── -->
      <div class="fc-verdict-footer" id="fcVerdictFooter">
        <div class="fc-verdict-card" id="fcVerdictCard">
          <div id="fcVerdictBadge" class="fc-verdict-badge">—</div>
          <div class="fc-verdict-right">
            <div id="fcVerdictProfit" class="fc-verdict-profit">—</div>
            <span id="fcVerdictSub" class="fc-verdict-sub">Profit</span>
          </div>
        </div>
        <div class="fc-mbar-wrap">
          <div class="fc-mbar-bg"><div class="fc-mbar-fill" id="fcMbarFill"></div></div>
          <span class="fc-mbar-pct" id="fcMbarPct">—</span>
        </div>
      </div>

      <!-- ── SETTINGS OVERLAY ── -->
      <div class="fc-settings-overlay" id="fcSettingsOverlay">
        <div class="fc-set-overlay-hdr">
          <span>EINSTELLUNGEN</span>
          <button class="fc-btn-icon" id="fcSettingsCloseBtn">✕</button>
        </div>
        <div class="fc-set-overlay-body">
          <div class="fc-set-sec">
            <div class="fc-set-title">Standard-Marktplatz</div>
            <div class="fc-set-row">
              <span class="fc-set-label">Markt</span>
              <div class="fc-set-mkt-row">
                <button class="fc-set-mkt-btn active" data-setmarket="ebay">eBay</button>
                <button class="fc-set-mkt-btn" data-setmarket="amazon">Amazon</button>
              </div>
            </div>
          </div>
          <div class="fc-set-sec">
            <div class="fc-set-title">Panel-Position</div>
            <div class="fc-set-row">
              <span class="fc-set-label">Position</span>
              <div class="fc-pos-btns">
                <button class="fc-pos-btn" data-pos="left">Links</button>
                <button class="fc-pos-btn active" data-pos="right">Rechts</button>
                <button class="fc-pos-btn" data-pos="bottom">Unten</button>
              </div>
            </div>
          </div>
          <div class="fc-set-sec">
            <div class="fc-set-title">eBay Einstellungen</div>
            <div class="fc-set-row">
              <span class="fc-set-label">Versand (€)</span>
              <input class="fc-set-inp" id="setShipOut" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
            <div class="fc-set-row">
              <span class="fc-set-label">Kategorie</span>
              <select class="fc-set-select" id="setCatId"></select>
            </div>
          </div>
          <div class="fc-set-saved" id="setSavedMsg">✓ Gespeichert</div>
        </div>
      </div>

    </div><!-- /fc-wrap -->
  `;

  // ── Class ───────────────────────────────────────────────────────────────
  class FlipcheckPanel extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'closed' });
      shadow.innerHTML = PANEL_HTML;
      // Full-height sidebar positioning — must override any page CSS
      this.style.setProperty('position', 'fixed',       'important');
      this.style.setProperty('display',  'block',       'important');
      this.style.setProperty('z-index',  '2147483647',  'important');
      this.style.setProperty('top',      '0',           'important');
      this.style.setProperty('right',    '0',           'important');
      this.style.setProperty('bottom',   'auto',        'important');
      this.style.setProperty('height',   '100vh',       'important');
      this.style.setProperty('width',    'auto',        'important');
      this._shadow       = shadow;
      this._market       = 'ebay';
      this._identifier   = null;
      this._mode         = 'mid';
      this._lastEk       = 0;
      this._result       = null;
      this._resultTs     = null;
      this._chartSeries  = null;
      this._rankSeries   = null;   // BSR rank series (Amazon)
      this._qtySeries    = null;   // Volume/qty series (eBay)
      this._chartDays    = 30;
      this._chartLayout  = null;   // {PAD,cw,ch,pts,W,H,toX,toY} — for hover
      this._innerTab     = 'check';
      this._alertOpen    = false;
      this._amazonMethod = 'fba';
      this._defaults     = { market: 'ebay', shipOut: 0, catId: 'sonstiges' };
      this._resultCache  = {};
      this._crossId      = null;
      this._crossPending = false;
      this._position     = 'right';
      try {
        chrome.storage.local.get(['fc_size', 'fc_position'], r => {
          const savedW = r?.fc_size?.w;
          if (savedW) {
            const wrap = this._shadow?.querySelector('.fc-wrap');
            if (wrap) wrap.style.width = Math.min(640, Math.max(260, savedW)) + 'px';
          }
          this._applyPosition(r?.fc_position || 'right');
        });
      } catch (_) {}
      this._wireEvents();
      this._loadDefaults();
    }

    connectedCallback() {
      const dm = this.dataset?.market;
      if (dm && ['ebay','amazon','kaufland'].includes(dm) && dm !== this._market) {
        this._market = dm;
        this._shadow.querySelectorAll('.fc-mkt-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.market === dm));
      }
    }

    disconnectedCallback() {
      this.dispatchEvent(new CustomEvent('fc-disconnected', { bubbles: false }));
    }

    // ── Public API ──────────────────────────────────────────────────────────
    probe(identifier, market) {
      this._resultCache  = {};
      this._crossId      = null;
      this._crossPending = false;
      if (!market && this._defaults.market) market = this._defaults.market;
      if (market) this._setMarket(market, false);
      this._identifier = identifier;
      this._shadow.getElementById('fcIdTag').textContent = identifier || '';
      if (this._defaults.shipOut > 0) {
        const si = this._shadow.getElementById('deShipOut');
        if (si && !parseFloat(si.value)) si.value = this._defaults.shipOut.toFixed(2);
      }
      this._autoFillPagePrice();
      this._setState('loading');
      this._fetchResult();
    }

    _autoFillPagePrice() {
      if (typeof detectPagePrice !== 'function') return;
      const inp = this._shadow.getElementById('fcEkInp');
      if (parseFloat(inp?.value) > 0) return;
      const price = detectPagePrice();
      if (price > 0) { this.autofillEk(price); return; }
      const _try = () => {
        if (parseFloat(inp?.value) > 0) return;
        const p = detectPagePrice();
        if (p > 0) this.autofillEk(p);
      };
      setTimeout(_try, 600); setTimeout(_try, 1800);
    }

    setIdentifier(identifier, market) {
      if (market) this._setMarket(market, false);
      this._identifier = identifier;
      this._shadow.getElementById('fcIdTag').textContent = identifier || '';
      this._setState('idle');
    }

    setEan(ean) { this.setIdentifier(ean, 'ebay'); }
    get currentEan()    { return this._identifier; }
    get currentMarket() { return this._market || 'ebay'; }
    setMarket(market)   { this._setMarket(market, false); }
    setState(s)         { this._setState(s); }
    setCrossId(id) {
      if (!id) return;
      this._crossId = id;
      // ── Late EAN arrival ─────────────────────────────────────────────────────
      // If we're already in eBay/Kaufland mode but _identifier is still the ASIN
      // (because ASIN_TO_EAN resolved after probe() ran), swap identifiers and
      // auto-run the check so the panel never shows empty results.
      const _isAsin = s => /^[A-Z0-9]{10}$/.test(String(s || '')) && /[A-Z]/.test(String(s || ''));
      if (this._market !== 'amazon' && _isAsin(this._identifier)) {
        const oldId = this._identifier;
        this._identifier = id;
        this._crossId    = oldId;
        if (this._shadow) {
          this._shadow.getElementById('fcIdTag').textContent = id;
          this._setState('loading');
          this._fetchResult();
        }
      }
    }

    setAmzCategory(catId) {
      if (!catId) return;
      this._defaults.amzCategory = catId;
    }

    autofillEk(price) {
      const inp = this._shadow.getElementById('fcEkInp');
      inp.value = Number(price).toFixed(2);
      inp.classList.add('autofilled');
      setTimeout(() => inp.classList.remove('autofilled'), 1500);
    }

    // ── Wire Events ─────────────────────────────────────────────────────────
    _wireEvents() {
      const s = this._shadow;

      s.getElementById('fcCloseBtn').addEventListener('click', () => this.remove());

      // Settings overlay
      const overlay = s.getElementById('fcSettingsOverlay');
      s.getElementById('fcSettingsBtn')?.addEventListener('click', () => {
        overlay?.classList.add('open');
      });
      s.getElementById('fcSettingsCloseBtn')?.addEventListener('click', () => {
        overlay?.classList.remove('open');
      });

      // Accordion toggle
      s.querySelectorAll('.fc-acc-head').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.closest('.fc-acc')?.classList.toggle('open');
        });
      });

      // Position selector
      s.querySelectorAll('.fc-pos-btn').forEach(btn =>
        btn.addEventListener('click', () => { this._applyPosition(btn.dataset.pos); })
      );

      // Market toggle
      s.querySelectorAll('.fc-mkt-btn').forEach(btn =>
        btn.addEventListener('click', () => {
          if (btn.dataset.market !== this._market) this._setMarket(btn.dataset.market, true);
        }));

      // Mode pills (in header still kept for backward compat, plus new ones in check pane)
      s.querySelectorAll('.fc-mode-pill').forEach(btn =>
        btn.addEventListener('click', () => {
          if (btn.dataset.mode !== this._mode) {
            this._mode = btn.dataset.mode;
            s.querySelectorAll('.fc-mode-pill').forEach(b => b.classList.toggle('active', b.dataset.mode === this._mode));
            if (this._identifier) { this._setState('loading'); this._fetchResult(); }
          }
        }));

      // Inner tabs
      s.querySelectorAll('.fc-tab').forEach(tab =>
        tab.addEventListener('click', () => { if (!tab.disabled) this._setInnerTab(tab.dataset.itab); }));

      // Check
      s.getElementById('fcCheckBtn').addEventListener('click', () => this._runCheck());
      s.getElementById('fcEkInp').addEventListener('keydown', e => { if (e.key === 'Enter') this._runCheck(); });
      s.getElementById('fcRetryBtn').addEventListener('click', () => {
        if (!this._identifier) return;
        this._setState('loading'); this._fetchResult();
      });

      // Scan EAN
      const scanBtn = s.getElementById('fcScanBtn');
      if (scanBtn) {
        scanBtn.addEventListener('click', () => {
          scanBtn.disabled = true; scanBtn.textContent = '⟳ Scanne…';
          this.dispatchEvent(new CustomEvent('fc-manual-ean', { bubbles: true, composed: true }));
          setTimeout(() => {
            if (scanBtn.disabled) { scanBtn.disabled = false; scanBtn.textContent = '🔍 Seite neu scannen'; }
          }, 6000);
        });
      }

      // Alert
      s.getElementById('fcAlertBtn').addEventListener('click', () => this._toggleAlertForm());
      s.getElementById('fcAlertSubmit').addEventListener('click', () => this._submitAlert());
      s.getElementById('fcAlertInp').addEventListener('keydown', e => { if (e.key === 'Enter') this._submitAlert(); });

      // Chart ranges
      s.querySelectorAll('.fc-chart-rbtn').forEach(btn =>
        btn.addEventListener('click', () => {
          const days = Number(btn.dataset.days);
          if (days !== this._chartDays) {
            this._chartDays = days;
            s.querySelectorAll('.fc-chart-rbtn').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
            this._drawChart();
            // Fix 8: if data is sparse for this range, try fetching more from local history
            const cutoff = Date.now() - days * 86400000;
            const pts = (this._chartSeries || []).filter(p => p.ts >= cutoff);
            if (pts.length < 3 && days > 30 && this._identifier) {
              chrome.runtime.sendMessage({ type: 'PRICE_HISTORY_GET', ean: this._identifier }, res => {
                if (chrome.runtime.lastError || !res?.ok) return;
                const entries = Array.isArray(res.data) ? res.data : res.data?.entries;
                if (entries?.length > (this._chartSeries?.length || 0)) {
                  this._chartSeries = entries.map(p => ({ ts: p.ts ?? p.timestamp, price: Number(p.price ?? p.vk) })).filter(p => isFinite(p.price) && p.price > 0);
                  this._drawChart();
                }
              });
            }
          }
        }));

      // Chart hover
      const canvas = s.getElementById('fcChartCanvas');
      canvas.addEventListener('mousemove', e => this._onChartHover(e));
      canvas.addEventListener('mouseleave', () => this._onChartLeave());

      // Details eBay recalc
      s.getElementById('deRecalcBtn').addEventListener('click', () => this._recalcEbay());

      // Details Amazon method toggle
      s.querySelectorAll('.fc-det-tog-btn').forEach(btn =>
        btn.addEventListener('click', () => {
          this._amazonMethod = btn.dataset.method;
          s.querySelectorAll('.fc-det-tog-btn').forEach(b => b.classList.toggle('active', b.dataset.method === this._amazonMethod));
          s.getElementById('daShipInRow').style.display = this._amazonMethod === 'fbm' ? 'flex' : 'none';
        }));

      // Details Amazon recalc
      s.getElementById('daRecalcBtn').addEventListener('click', () => this._recalcAmazon());

      // Lagerkosten live recalc on input change
      s.getElementById('daSizeCategory')?.addEventListener('change', () => this._recalcAmazon());
      s.getElementById('daLagermonate')?.addEventListener('input',  () => this._recalcAmazon());

      // ── Resize handle (left edge drag) ─────────────────────────────────────
      const resizer = s.getElementById('fcResizer');
      const wrap    = s.querySelector('.fc-wrap');
      if (resizer && wrap) {
        resizer.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          resizer.setPointerCapture(ev.pointerId);
          resizer.classList.add('dragging');
          const startX   = ev.clientX;
          const startW   = wrap.offsetWidth;
          const onMove = e => {
            const delta = this._position === 'left' ? (e.clientX - startX) : (startX - e.clientX);
            const newW = Math.min(620, Math.max(280, startW + delta));
            wrap.style.width = newW + 'px';
            this.style.setProperty('width', newW + 'px', 'important');
            try { chrome.storage.local.set({ fc_size: { w: newW } }); } catch (_) {}
            this.dispatchEvent(new CustomEvent('fc-width-change', { detail: { w: newW, pos: this._position } }));
          };
          const onUp = () => {
            resizer.classList.remove('dragging');
            resizer.removeEventListener('pointermove', onMove);
            resizer.removeEventListener('pointerup',   onUp);
          };
          resizer.addEventListener('pointermove', onMove);
          resizer.addEventListener('pointerup',   onUp);
        });
      }

      // Settings
      s.querySelectorAll('[data-setmarket]').forEach(btn =>
        btn.addEventListener('click', () => {
          s.querySelectorAll('[data-setmarket]').forEach(b => b.classList.toggle('active', b === btn));
          this._saveDefaults();
        }));
      const catSel = s.getElementById('setCatId');
      if (catSel && typeof fcBuildCatOptions === 'function') catSel.innerHTML = fcBuildCatOptions(this._defaults.catId || 'sonstiges');
      catSel?.addEventListener('change', () => this._saveDefaults());
      s.getElementById('setShipOut')?.addEventListener('change', () => this._saveDefaults());
      s.getElementById('setShipOut')?.addEventListener('blur',   () => this._saveDefaults());
    }

    // ── Market ──────────────────────────────────────────────────────────────
    _setMarket(market, refetch) {
      const prevMarket = this._market;
      this._market = market;
      const s = this._shadow;

      if (refetch && this._crossId && prevMarket !== market) {
        const oldId      = this._identifier;
        this._identifier = this._crossId;
        this._crossId    = oldId;
        s.getElementById('fcIdTag').textContent = this._identifier || '';
      }

      s.querySelectorAll('.fc-mkt-btn').forEach(b => b.classList.toggle('active', b.dataset.market === market));
      const vkLabels    = { amazon: 'Ø Buy Box 30T', kaufland: 'Günstigster Neu', ebay: 'Median VK' };
      const feeLabels   = { amazon: 'Ref + FBA', kaufland: 'KL Gebühr', ebay: 'eBay Gebühr' };
      const salesLabels = { amazon: 'Est. Verk./Mo', kaufland: 'Vol. (Cross-Mkt)', ebay: 'Verk./30d' };
      s.getElementById('kvVkLabel').textContent     = vkLabels[market]    || vkLabels.ebay;
      s.getElementById('kvFeeLabel').textContent    = feeLabels[market]   || feeLabels.ebay;
      s.getElementById('kvSalesLabel').textContent  = salesLabels[market] || salesLabels.ebay;
      s.getElementById('legendPrimary').textContent = vkLabels[market]    || vkLabels.ebay;

      const prepRow = s.getElementById('fcPrepRow');
      if (prepRow) prepRow.classList.toggle('open', market === 'amazon');

      if (this._result) {
        const accE = s.getElementById('accEbay');
        const accA = s.getElementById('accAmazon');
        if (accE) accE.style.display = market === 'ebay'     ? '' : 'none';
        if (accA) accA.style.display = market === 'amazon'   ? '' : 'none';
      }

      if (refetch && this._identifier) {
        const cached = this._resultCache[market];
        if (cached?.data && (Date.now() - cached.ts) < 300000) {
          this._result   = cached.data;
          this._resultTs = cached.ts;
          this._renderResult(cached.data);
          this._populateDetails(cached.data);
          this._loadChartSeries(cached.data);
          this._checkInventoryStatus(this._identifier);
          return;
        }
        const isAsin = id => /^[A-Z0-9]{10}$/.test(String(id||'')) && /[A-Z]/.test(String(id||''));
        if ((market === 'ebay' || market === 'kaufland') && isAsin(this._identifier)) {
          this._setState('loading');
          chrome.runtime.sendMessage({ type: 'ASIN_TO_EAN', asin: this._identifier }, res => {
            if (chrome.runtime.lastError) { this._setState('error'); return; }
            const ean = res?.ean;
            if (ean) {
              this._crossId    = this._identifier;
              this._identifier = ean;
              s.getElementById('fcIdTag').textContent = ean;
              this._fetchResult();
            } else {
              this._market = prevMarket;
              s.querySelectorAll('.fc-mkt-btn').forEach(b => b.classList.toggle('active', b.dataset.market === prevMarket));
              const msgEl = s.getElementById('fcErrorMsg');
              if (msgEl) msgEl.textContent = 'EAN / GTIN für dieses Produkt nicht gefunden.';
              this._setState('error');
            }
          });
          return;
        }
        this._setState('loading');
        this._fetchResult();
      }
    }

    // ── Tabs ────────────────────────────────────────────────────────────────
    _setInnerTab(tab) {
      this._innerTab = tab;
      const s = this._shadow;
      // Panes hidden in sidebar mode (display:none !important), kept for JS compat
      const map = { check:'paneCheck', chart:'paneChart', details:'paneDetails', settings:'paneSettings' };
      s.querySelectorAll('.fc-tab').forEach(t => t.classList.toggle('active', t.dataset.itab === tab));
      s.querySelectorAll('.fc-pane').forEach(p => p.classList.toggle('active', p.id === map[tab]));
      if (tab === 'chart') setTimeout(() => this._drawChart(), 30);
    }

    _disableDataTabs() { /* sidebar: no tabs, no-op */ }
    _enableDataTabs()  { /* sidebar: no tabs, no-op */ }

    // ── Check ───────────────────────────────────────────────────────────────
    _runCheck() {
      this._lastEk = parseFloat(this._shadow.getElementById('fcEkInp').value) || 0;
      if (!this._identifier) { this._setState('no-ean'); return; }

      // Guard: never fire eBay/Kaufland with an ASIN — resolve to EAN first
      const _isAsin = s => /^[A-Z0-9]{10}$/.test(String(s || '')) && /[A-Z]/.test(String(s || ''));
      if (this._market !== 'amazon' && _isAsin(this._identifier)) {
        if (this._crossId) {
          // EAN already known — swap and proceed
          const tmp        = this._identifier;
          this._identifier = this._crossId;
          this._crossId    = tmp;
          this._shadow.getElementById('fcIdTag').textContent = this._identifier;
        } else {
          // Need to resolve ASIN → EAN in background first
          this._setState('loading');
          chrome.runtime.sendMessage({ type: 'ASIN_TO_EAN', asin: this._identifier }, res => {
            if (chrome.runtime.lastError) { this._setState('error'); return; }
            const ean = res?.ean;
            if (ean) {
              this._crossId    = this._identifier;
              this._identifier = ean;
              this._shadow.getElementById('fcIdTag').textContent = ean;
              this._fetchResult();
            } else {
              this._setState('no-ean');
            }
          });
          return;
        }
      }

      this._setState('loading');
      this._fetchResult();
    }

    _fetchResult() {
      const s     = this._shadow;
      const ekVal = parseFloat(s.getElementById('fcEkInp').value);
      if (!isNaN(ekVal)) this._lastEk = ekVal;
      this._disableDataTabs();

      if (this._market === 'amazon') {
        const prepVal = parseFloat(s.getElementById('fcPrepInp')?.value) || 0;
        chrome.runtime.sendMessage({
          type:'AMAZON_CHECK', asin:this._identifier, ean:this._identifier,
          ek:this._lastEk, mode:this._mode, method:this._amazonMethod,
          shipIn:parseFloat(s.getElementById('daShipIn')?.value)||0, prepFee:prepVal,
        }, res => {
          if (chrome.runtime.lastError) { this._setState('error'); return; }
          this._handleApiResponse(res);
        });
      } else if (this._market === 'kaufland') {
        chrome.runtime.sendMessage({
          type:'FLIPCHECK', ean:this._identifier, ek:this._lastEk, mode:this._mode,
          market:'kaufland',
        }, res => {
          if (chrome.runtime.lastError) { this._setState('error'); return; }
          this._handleApiResponse(res);
        });
      } else {
        chrome.runtime.sendMessage({
          type:'FLIPCHECK', ean:this._identifier, ek:this._lastEk, mode:this._mode,
        }, res => {
          if (chrome.runtime.lastError) { this._setState('error'); return; }
          this._handleApiResponse(res);
        });
      }
    }

    _handleApiResponse(res) {
      if (!res?.ok) {
        if (res?.error === 'plan_limit') {
          const btn = this._shadow.getElementById('fcUpgradeBtn');
          if (btn && res.upgradeUrl) btn.href = res.upgradeUrl;
          this._setState('plan-limit');
        } else {
          const msgEl = this._shadow.getElementById('fcErrorMsg');
          if (msgEl && res?.error) msgEl.textContent = res.error;
          this._setState('error');
        }
        return;
      }
      this._result   = res.data;
      this._resultTs = Date.now();
      this._resultCache[this._market] = { data: res.data, ts: Date.now() };
      if (!this._crossId && res.data) {
        if (this._market === 'ebay'   && res.data.asin) this._crossId = res.data.asin;
        if (this._market === 'amazon' && res.data.ean)  this._crossId = res.data.ean;
      }
      this._renderResult(res.data);
      this._populateDetails(res.data);
      this._loadChartSeries(res.data);
      this._checkInventoryStatus(this._identifier);
      this._fetchCrossMarket();
      // Extra chart fetch for eBay — get 365d series for range buttons (30T/90T/1J)
      if (this._market === 'ebay') this._fetchEbayChart();
    }

    // ── Render Result ───────────────────────────────────────────────────────
    _renderResult(d) {
      const s      = this._shadow;
      const fmt    = v => v != null && !isNaN(v) ? `€${Number(v).toFixed(2)}` : '—';
      const fmtPct = v => v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%`  : '—';

      // Verdict card
      const VC = {
        BUY:  { bg: 'rgba(34,197,94,.09)',  border: 'rgba(34,197,94,.22)',  text: '#22C55E' },
        HOLD: { bg: 'rgba(245,158,11,.09)', border: 'rgba(245,158,11,.22)', text: '#F59E0B' },
        SKIP: { bg: 'rgba(239,68,68,.09)',  border: 'rgba(239,68,68,.22)',  text: '#EF4444' },
      };
      const vc    = VC[d.verdict] || { bg: 'rgba(99,102,241,.07)', border: 'rgba(99,102,241,.2)', text: '#6366F1' };
      const card  = s.getElementById('fcVerdictCard');
      card.style.background   = vc.bg;
      card.style.borderColor  = vc.border;
      const badge = s.getElementById('fcVerdictBadge');
      badge.textContent  = d.verdict || '—';
      badge.style.color  = vc.text;
      const profitEl = s.getElementById('fcVerdictProfit');
      profitEl.textContent = fmt(d.profit_median);
      profitEl.style.color = vc.text;

      // Margin bar
      const margin    = Number(d.margin_pct) || 0;
      const barFill   = s.getElementById('fcMbarFill');
      const barWidth  = Math.min(100, Math.max(0, Math.abs(margin) * 2));
      barFill.style.width      = barWidth + '%';
      barFill.style.background = margin >= 15 ? '#22C55E' : margin >= 5 ? '#F59E0B' : '#EF4444';
      s.getElementById('fcMbarPct').textContent  = fmtPct(margin);
      s.getElementById('fcMbarPct').style.color  = margin >= 15 ? '#22C55E' : margin >= 5 ? '#F59E0B' : '#EF4444';

      // Title + product image (in header product bar)
      const titleEl = s.getElementById('fcTitle');
      if (titleEl) titleEl.textContent = d.title ? d.title.slice(0, 80) : '';
      const imgEl = s.getElementById('fcProductImg');
      if (imgEl) {
        if (d.product_image) {
          imgEl.src = d.product_image;
          imgEl.style.display = 'block';
        } else {
          imgEl.style.display = 'none';
        }
      }

      // ID chips
      const idEl   = s.getElementById('fcIdDisplay');
      const ident  = this._identifier || '';
      const isAsin = /^[A-Z0-9]{10}$/.test(ident.toUpperCase()) && /[A-Z]/i.test(ident);
      const chips  = [];
      if (isAsin) {
        chips.push(`<span class="fc-id-chip" data-copy="${ident}"><span class="fc-id-chip-lbl">ASIN</span>${ident}</span>`);
        if (d.ean && d.ean !== ident) chips.push(`<span class="fc-id-chip" data-copy="${d.ean}"><span class="fc-id-chip-lbl">EAN</span>${d.ean}</span>`);
      } else {
        if (ident) chips.push(`<span class="fc-id-chip" data-copy="${ident}"><span class="fc-id-chip-lbl">EAN</span>${ident}</span>`);
        if (d.asin) chips.push(`<span class="fc-id-chip" data-copy="${d.asin}"><span class="fc-id-chip-lbl">ASIN</span>${d.asin}</span>`);
      }
      idEl.innerHTML = chips.join('');
      idEl.querySelectorAll('.fc-id-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          navigator.clipboard.writeText(chip.dataset.copy).then(() => {
            const orig = chip.innerHTML;
            chip.innerHTML = '<span class="fc-id-chip-lbl">✓</span>Kopiert';
            setTimeout(() => { chip.innerHTML = orig; }, 1200);
          });
        });
      });

      // Price-compare links (Idealo + Geizhals) — use EAN when available, else title
      const compareQuery = (() => {
        const ean = isAsin ? (d.ean || this._crossId || '') : (ident || '');
        return ean || d.title || '';
      })();
      if (compareQuery) {
        const qEnc = encodeURIComponent(compareQuery);
        const idealoBtn  = s.getElementById('fcIdealoBtn');
        const geizhalsBtn = s.getElementById('fcGeizhalsBtn');
        if (idealoBtn)  idealoBtn.href  = `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${qEnc}`;
        if (geizhalsBtn) geizhalsBtn.href = `https://geizhals.de/?fs=${qEnc}&hloc=at&hloc=de`;

        // Cross-market links (show links to other markets, not the current one)
        const marketLinksRow = s.getElementById('fcMarketLinks');
        const linkEbay     = s.getElementById('fcLinkEbay');
        const linkAmazon   = s.getElementById('fcLinkAmazon');
        const linkKaufland = s.getElementById('fcLinkKaufland');
        if (marketLinksRow) {
          marketLinksRow.style.display = 'flex';
          if (linkEbay) {
            linkEbay.style.display = this._market === 'ebay' ? 'none' : '';
            linkEbay.href = `https://www.ebay.de/sch/i.html?_nkw=${qEnc}`;
          }
          if (linkAmazon) {
            linkAmazon.style.display = this._market === 'amazon' ? 'none' : '';
            linkAmazon.href = `https://www.amazon.de/s?k=${qEnc}`;
          }
          if (linkKaufland) {
            linkKaufland.style.display = this._market === 'kaufland' ? 'none' : '';
            linkKaufland.href = `https://www.kaufland.de/s/?search_value=${qEnc}`;
          }
        }
      }

      // KPIs
      if (this._market === 'amazon') {
        const vk30     = d.buy_box_avg30 || d.sell_price_median;
        s.getElementById('kvVk').textContent = fmt(vk30);
        const totalFee = (d.referral_fee ?? 0) + (d.fba_fee ?? 0);
        s.getElementById('kvFee').textContent = totalFee > 0 ? `-€${totalFee.toFixed(2)}` : '—';
        // Sales display: badge value if available, else estimate with drops annotation
        const src = d.sales_30d_source;
        const salesStr = d.sales_30d != null
          ? (src === 'badge' ? `${d.sales_30d}+` : `~${d.sales_30d}`)
          : '—';
        const dropsNote = (d.bsr_drops_30d > 0 && src !== 'badge') ? ` (${d.bsr_drops_30d}↓)` : '';
        s.getElementById('kvSales').textContent    = salesStr + dropsNote;
        s.getElementById('kvSalesLabel').textContent = src === 'badge' ? 'Verk./Mo 🏷' : 'Est. Verk./Mo';
        this._renderVelocityBar(d.sales_30d);
      } else if (this._market === 'kaufland') {
        s.getElementById('kvVk').textContent = fmt(d.sell_price_avg);
        s.getElementById('kvFee').textContent = d.fees_median != null ? `-€${Number(d.fees_median).toFixed(2)}` : '—';
        // Kaufland has no native sales data — show cross-market volume hints
        const volParts = [];
        if (d.volume_hint_ebay) volParts.push(`~${d.volume_hint_ebay} eBay`);
        if (d.volume_hint_amazon) volParts.push(`~${d.volume_hint_amazon} Amz`);
        s.getElementById('kvSales').textContent     = volParts.length ? volParts.join(' · ') : '—';
        s.getElementById('kvSalesLabel').textContent = volParts.length ? 'Vol. (Cross-Mkt)' : 'Volumen';
        this._renderVelocityBar(d.volume_hint_ebay || d.volume_hint_amazon || null);
      } else {
        s.getElementById('kvVk').textContent = fmt(d.sell_price_median);
        let feeAmt = d.fee ?? d.ebay_fee ?? null;
        if (feeAmt == null && d.sell_price_median != null) {
          const catId = this._defaults.catId || 'sonstiges';
          feeAmt = typeof fcCalcEbayFee === 'function'
            ? fcCalcEbayFee(Number(d.sell_price_median), catId)
            : Number(d.sell_price_median) * 0.13;
        }
        s.getElementById('kvFee').textContent = feeAmt != null ? `-€${Number(feeAmt).toFixed(2)}` : '—';
        s.getElementById('kvSales').textContent     = d.sales_30d != null ? String(d.sales_30d) : '—';
        s.getElementById('kvSalesLabel').textContent = 'Verk./30d';
        this._renderVelocityBar(d.sales_30d);
      }

      // Reset actions
      const invBtn = s.getElementById('fcInvBtn');
      invBtn.textContent = '＋ Inventar'; invBtn.className = 'fc-action-btn'; invBtn.disabled = false;
      invBtn.onclick = () => this._addToInventory(d);
      this._alertOpen = false;
      s.getElementById('fcAlertForm').classList.remove('open');
      s.getElementById('fcAlertInp').value = '';
      s.getElementById('fcAlertFb').style.display = 'none';
      this._updateCachedNote();
      this._enableDataTabs();
      this._setState('result');
    }

    _renderVelocityBar(sales) {
      const fill = this._shadow.getElementById('fcVelFill');
      if (sales == null || isNaN(sales)) { fill.style.width = '0%'; fill.style.background = '#EF4444'; return; }
      const n = Number(sales);
      fill.style.background = n >= 50 ? '#22C55E' : n >= 10 ? '#F59E0B' : '#EF4444';
      fill.style.width = n >= 50 ? '100%' : n >= 10 ? `${20 + (n/50)*80}%` : `${Math.max(4, (n/10)*30)}%`;
    }

    // ── Inventory & Alerts ──────────────────────────────────────────────────
    _addToInventory(d) {
      const ek  = parseFloat(this._shadow.getElementById('fcEkInp').value) || 0;
      const btn = this._shadow.getElementById('fcInvBtn');
      btn.disabled = true; btn.textContent = '…';
      chrome.runtime.sendMessage({
        type: 'INVENTORY_ADD',
        item: { ean: this._identifier, title: d.title||'', ek, status:'IN_STOCK', market:this._market, qty:1 },
      }, res => {
        if (res?.ok) {
          btn.textContent = '✓ Gespeichert'; btn.className = 'fc-action-btn saved';
          setTimeout(() => { btn.textContent = '＋ Inventar'; btn.className = 'fc-action-btn'; btn.disabled = false; }, 2500);
        } else {
          btn.textContent = 'Desktop inaktiv';
          setTimeout(() => { btn.textContent = '＋ Inventar'; btn.disabled = false; }, 2000);
        }
      });
    }

    _checkInventoryStatus(identifier) {
      chrome.runtime.sendMessage({ type:'INVENTORY_CHECK', ean:identifier }, res => {
        if (chrome.runtime.lastError || !res?.found) return;
        const btn = this._shadow.getElementById('fcInvBtn');
        const qty = res.item?.qty > 0 ? ` (${res.item.qty}×)` : '';
        btn.textContent = `✓ Im Inventar${qty}`; btn.className = 'fc-action-btn saved'; btn.onclick = null;
      });
    }

    _toggleAlertForm() {
      this._alertOpen = !this._alertOpen;
      this._shadow.getElementById('fcAlertForm').classList.toggle('open', this._alertOpen);
      if (this._alertOpen) setTimeout(() => this._shadow.getElementById('fcAlertInp').focus(), 50);
    }

    _submitAlert() {
      const inp         = this._shadow.getElementById('fcAlertInp');
      const targetPrice = parseFloat(inp.value);
      if (!targetPrice || targetPrice <= 0) { inp.focus(); return; }
      const feedback = this._shadow.getElementById('fcAlertFb');
      const d        = this._result || {};
      chrome.runtime.sendMessage({
        type:'ALERTS_CREATE',
        alert:{ ean:this._identifier, title:d.title||this._identifier||'', target_price:targetPrice, market:this._market },
      }, res => {
        const ok = !res || res.ok !== false;
        feedback.textContent   = ok ? '✓ Alarm gesetzt' : '✗ Fehler';
        feedback.style.color   = ok ? '#22C55E' : '#EF4444';
        feedback.style.display = 'block';
        setTimeout(() => {
          feedback.style.display = 'none'; inp.value = '';
          this._alertOpen = false;
          this._shadow.getElementById('fcAlertForm').classList.remove('open');
        }, 2000);
      });
    }

    // ── Details Tab ─────────────────────────────────────────────────────────
    _populateDetails(d) {
      const s   = this._shadow;
      const fmt = v => v != null && !isNaN(v) ? `€${Number(v).toFixed(2)}` : '—';
      // Show correct accordion
      const accE = s.getElementById('accEbay');
      const accA = s.getElementById('accAmazon');
      if (accE) accE.style.display = this._market === 'ebay'   ? '' : 'none';
      if (accA) accA.style.display = this._market === 'amazon' ? '' : 'none';

      if (this._market === 'ebay') {
        // Fields from /flipcheck backend response
        const listings = d.offer_count ?? d.listing_count ?? d.active_listings ?? d.listings ?? d.active;
        s.getElementById('deListings').textContent  = listings != null ? String(listings) : '—';
        const dtc = d.days_to_cash ?? d.avg_days_to_sell ?? d.dtc;
        s.getElementById('deDtc').textContent       = dtc != null ? `${dtc}T` : '—';
        // browse_avg = current average listing price (from eBay Browse API)
        const browseAvg = d.browse_avg ?? d.sell_price_avg;
        s.getElementById('deBrowseAvg').textContent = browseAvg != null ? fmt(browseAvg) : '—';
        // sales_30d estimate
        s.getElementById('deSales30d').textContent  = d.sales_30d != null ? `~${d.sales_30d}` : '—';
        // sell_price_median = Ø historical sold price
        s.getElementById('deSellAvg').textContent   = fmt(d.sell_price_median ?? d.sell_price_avg);
        // fees
        const fees = d.fees_median ?? d.fees_avg ?? d.fee;
        s.getElementById('deFeesMedian').textContent = fees != null ? fmt(fees) : '—';
      } else {
        s.getElementById('daBoxPrice').textContent  = fmt(d.buy_box);
        s.getElementById('daBoxAvg30').textContent  = fmt(d.buy_box_avg30);
        const refPct = d.referral_pct != null ? `${Number(d.referral_pct).toFixed(0)}%` : '';
        s.getElementById('daRefFee').textContent    = refPct ? `${refPct} (${fmt(d.referral_fee)})` : fmt(d.referral_fee);
        // FBA fee — show tier label if weight data available
        const wKg = d.signals?.weight_kg;
        if (wKg && typeof fcGetFbaTier === 'function') {
          const tier = fcGetFbaTier(wKg, 20);
          s.getElementById('daFbaFee').textContent = `${fmt(d.fba_fee)} (${tier.label})`;
        } else {
          s.getElementById('daFbaFee').textContent = fmt(d.fba_fee);
        }
        // Closing fee (media categories)
        const closingCats = typeof AMAZON_CLOSING_CATS !== 'undefined' ? AMAZON_CLOSING_CATS : ['buecher'];
        const closingEl = s.getElementById('daClosingFee');
        if (closingEl) {
          const cat = this._defaults?.amzCategory || 'sonstiges';
          closingEl.textContent = closingCats.includes(cat) ? fmt(typeof AMAZON_CLOSING_FEE !== 'undefined' ? AMAZON_CLOSING_FEE : 1.01) : '—';
        }
        const prepFeeEl = s.getElementById('daPrepFee');
        if (prepFeeEl) prepFeeEl.textContent = d.prep_fee > 0 ? fmt(d.prep_fee) : '—';
        s.getElementById('daOffers').textContent    = d.fba_count != null
          ? `${d.fba_count} FBA / ${d.offer_count??'?'} ges.` : (d.offer_count ?? '—');
        s.getElementById('daRank').textContent      = d.sales_rank != null
          ? `#${Number(d.sales_rank).toLocaleString('de-DE')}` : '—';
        s.getElementById('daSales').textContent     = d.sales_30d != null ? `~${d.sales_30d}` : '—';

        // Fix 5: compute BSR drops from rank_series if bsr_drops_30d is missing/zero
        if ((d.bsr_drops_30d == null || d.bsr_drops_30d === 0) && Array.isArray(d.rank_series) && d.rank_series.length > 2) {
          const cutoff30 = Date.now() - 30 * 86400000;
          const recent = d.rank_series.filter(p => {
            const ts = Array.isArray(p) ? (p[0] < 1e9 ? (p[0]+21564000)*60000 : p[0]*1000) : (p.ts ?? 0);
            return ts >= cutoff30;
          });
          let drops = 0;
          for (let i = 1; i < recent.length; i++) {
            const cur  = Array.isArray(recent[i])   ? recent[i][1]   : recent[i].rank;
            const prev = Array.isArray(recent[i-1]) ? recent[i-1][1] : recent[i-1].rank;
            if (cur > 0 && prev > 0 && cur < prev) drops++;
          }
          if (drops > 0) d.bsr_drops_30d = drops;
        }

        const bsrEl = s.getElementById('daBsrDrops');
        if (d.bsr_drops_30d != null) {
          bsrEl.textContent = String(d.bsr_drops_30d);
          bsrEl.className   = 'fc-det-v ' + (d.bsr_drops_30d >= 10 ? 'green' : d.bsr_drops_30d >= 4 ? 'yellow' : '');
        } else { bsrEl.textContent = '—'; }

        const varEl = s.getElementById('daVariants');
        varEl.textContent = d.variation_count > 0 ? `${d.variation_count} Varianten`
          : d.variation_count === 0 ? 'Keine Varianten' : '—';

        // International prices
        const intlRow    = s.getElementById('daIntlRow');
        const intlWrap   = s.getElementById('daIntlPrices');
        const intlData   = d.intl_prices || {};
        const intlFlags  = { FR:'🇫🇷', UK:'🇬🇧', IT:'🇮🇹', ES:'🇪🇸', NL:'🇳🇱', PL:'🇵🇱' };
        const intlEntries = Object.entries(intlData).filter(([,p]) => p != null && p > 0);
        if (intlEntries.length > 0 && intlRow && intlWrap) {
          intlRow.style.display = '';
          intlWrap.innerHTML = intlEntries
            .sort((a, b) => a[1] - b[1])
            .map(([country, price]) =>
              `<span class="fc-intl-chip"><span class="fc-intl-flag">${intlFlags[country] || country}</span><span class="fc-intl-price">${country} €${Number(price).toFixed(2)}</span></span>`
            ).join('');
        } else if (intlRow) {
          intlRow.style.display = 'none';
        }

        // Fix 6: auto-detect size category from Keepa size_tier or fba_fee
        const sizeSel = s.getElementById('daSizeCategory');
        if (sizeSel && !sizeSel.dataset.userSet) {
          const tierMap = { SMALL:'klein', SMALL_STANDARD:'klein', STANDARD:'standard', LARGE:'uebergross', LARGE_OVERSIZE:'uebergross', OVERSIZED:'uebergross' };
          const cat = d.size_tier ? (tierMap[String(d.size_tier).toUpperCase()] || 'standard')
                    : d.fba_fee != null ? (d.fba_fee < 4.5 ? 'klein' : d.fba_fee > 9 ? 'uebergross' : 'standard')
                    : null;
          if (cat && sizeSel.value !== cat) sizeSel.value = cat;
        }
        sizeSel?.addEventListener('change', () => { sizeSel.dataset.userSet = '1'; }, { once: true });

        // Initial storage fee display + recalc profit including Lagergebühr
        this._recalcAmazon();
      }
    }

    _recalcEbay() {
      if (!this._result || this._market !== 'ebay') return;
      const shipOut  = parseFloat(this._shadow.getElementById('deShipOut').value) || 0;
      const d        = this._result;
      const vk       = Number(d.sell_price_median) || 0;
      const catId    = this._defaults.catId || 'sonstiges';
      const fee      = typeof fcCalcEbayFee === 'function' ? fcCalcEbayFee(vk, catId) : vk * 0.13;
      const profit   = vk - fee - this._lastEk - shipOut;
      const margin   = vk > 0 ? (profit / vk) * 100 : 0;
      const kvP = this._shadow.getElementById('fcVerdictProfit');
      kvP.textContent = `€${profit.toFixed(2)}`;
      const fill = this._shadow.getElementById('fcMbarFill');
      fill.style.width = Math.min(100, Math.max(0, Math.abs(margin) * 2)) + '%';
      this._shadow.getElementById('fcMbarPct').textContent = `${margin.toFixed(1)}%`;
    }

    _calcStorageFee() {
      // Amazon.de FBA Lagergebühren (monatlich pro Einheit)
      const RATES = {
        klein:      { normal: 0.43, q4: 0.94 },
        standard:   { normal: 0.51, q4: 1.21 },
        uebergross: { normal: 0.53, q4: 1.42 },
      };
      const s      = this._shadow;
      const cat    = s.getElementById('daSizeCategory')?.value || 'standard';
      const monate = parseFloat(s.getElementById('daLagermonate')?.value) || 0;
      const isQ4   = new Date().getMonth() >= 9; // Okt–Dez
      const rate   = (RATES[cat] || RATES.standard)[isQ4 ? 'q4' : 'normal'];
      const fee    = rate * monate;
      const el     = s.getElementById('daLagerFeeDisplay');
      if (el) el.textContent = fee > 0 ? `-€${fee.toFixed(2)}` : '—';
      return fee;
    }

    _recalcAmazon() {
      if (!this._result || this._market !== 'amazon') return;
      const s   = this._shadow;
      const d   = this._result;
      const vk  = Number(d.buy_box || d.sell_price_median) || 0;

      // Read user-adjustable inputs
      const shipIn     = parseFloat(s.getElementById('daShipIn').value) || 0;
      const storageMon = parseFloat(s.getElementById('daLagermonate')?.value) || 0;
      const sizeCat    = s.getElementById('daSizeCategory')?.value || 'standard';
      const method     = this._amazonMethod || 'fba';

      // Weight & category from API signals
      const weightKg   = d.signals?.weight_kg || 0.5;
      const longestCm  = 20; // Keepa doesn't always provide dimensions
      const category   = this._defaults?.amzCategory || 'sonstiges';
      const prepFee    = Number(d.prep_fee) || 0;

      // Use the full Revenue Calculator style profit calc
      if (typeof fcCalcAmazonProfit === 'function') {
        const calc = fcCalcAmazonProfit({
          sellPrice:  vk,
          ek:         this._lastEk,
          category,
          method,
          shipIn,
          fbaFee:     method === 'fba' ? (Number(d.fba_fee) || null) : null,
          weightKg,
          longestCm,
          prepFee,
          storageMon,
          sizeCat,
          vatMode:  'no_vat',  // extension doesn't track VAT yet
          ekMode:   'gross',
        });

        s.getElementById('fcVerdictProfit').textContent = `€${calc.profit.toFixed(2)}`;
        s.getElementById('fcMbarPct').textContent = `${calc.marginPct.toFixed(1)}%`;

        // Update detail cells with recalculated values
        const fmt = v => v != null && isFinite(v) ? `€${Number(v).toFixed(2)}` : '—';
        const refEl = s.getElementById('daRefFee');
        if (refEl) refEl.textContent = `${calc.referralPct}% (${fmt(calc.referralFeeGross)})`;
        const fbaEl = s.getElementById('daFbaFee');
        if (fbaEl) fbaEl.textContent = calc.fbaTierLabel ? `${fmt(calc.fbaFeeGross)} (${calc.fbaTierLabel})` : fmt(calc.fbaFeeGross);
        const closingEl = s.getElementById('daClosingFee');
        if (closingEl) closingEl.textContent = calc.closingFee > 0 ? fmt(calc.closingFee) : '—';
        const lagerEl = s.getElementById('daLagerFeeDisplay');
        if (lagerEl) lagerEl.textContent = calc.storageFee > 0 ? `-${fmt(calc.storageFee)}` : '—';
      } else {
        // Fallback: simple calculation
        const ref    = Number(d.referral_fee) || 0;
        const fba    = method === 'fba' ? (Number(d.fba_fee) || 0) : shipIn;
        const lager  = this._calcStorageFee();
        const profit = vk - ref - fba - lager - this._lastEk;
        const margin = vk > 0 ? (profit / vk) * 100 : 0;
        s.getElementById('fcVerdictProfit').textContent = `€${profit.toFixed(2)}`;
        s.getElementById('fcMbarPct').textContent = `${margin.toFixed(1)}%`;
      }
    }

    // ── Chart ────────────────────────────────────────────────────────────────
    _normSeries(raw) {
      return (raw || []).map(p => {
        if (Array.isArray(p)) {
          const t  = p[0];
          const v  = p[1];
          const ts = t < 1e9 ? (t + 21564000) * 60000 : (t > 1e12 ? t : t * 1000);
          return { ts, value: v };
        }
        return { ts: p.ts ?? p.timestamp ?? Date.now(), value: p.price ?? p.value ?? p.rank ?? 0 };
      }).filter(p => p.value != null && isFinite(p.value) && p.value >= 0);
    }

    _loadChartSeries(d) {
      const raw = d.price_series || d.amz_series || null;

      // BSR rank series (Amazon only)
      if (Array.isArray(d.rank_series) && d.rank_series.length >= 2) {
        this._rankSeries = this._normSeries(d.rank_series).filter(p => p.value > 0 && p.value < 10_000_000);
      } else {
        this._rankSeries = null;
      }

      // Volume/qty series (eBay Research API)
      if (Array.isArray(d.qty_series) && d.qty_series.length >= 2) {
        this._qtySeries = this._normSeries(d.qty_series).filter(p => p.value >= 0);
      } else {
        this._qtySeries = null;
      }

      if (!raw || raw.length < 2) {
        chrome.runtime.sendMessage({ type:'PRICE_HISTORY_GET', ean:this._identifier }, res => {
          if (chrome.runtime.lastError || !res?.ok) return;
          const pts = Array.isArray(res.data) ? res.data : res.data?.entries;
          if (!pts || pts.length < 2) return;
          this._chartSeries = pts.map(p => ({
            ts:    p.ts ?? p.timestamp ?? Date.now(),
            price: Number(p.price ?? p.vk ?? p),
          })).filter(p => isFinite(p.price) && p.price > 0);
          if (this._innerTab === 'chart') this._drawChart();
        });
        return;
      }
      this._chartSeries = this._normSeries(raw)
        .filter(p => p.value > 0 && p.value < 100000)
        .map(p => ({ ts: p.ts, price: p.value > 500 ? p.value / 100 : p.value }));
      if (this._innerTab === 'chart') this._drawChart();
    }

    // Smooth spline helper — uses Catmull-Rom bezier when data is dense,
    // falls back to straight line segments for sparse data (< 6 pts) to avoid oscillation.
    _drawCurve(ctx, pts, toX, toY) {
      if (pts.length < 2) return;
      ctx.moveTo(toX(pts[0].ts), toY(pts[0].price));
      if (pts.length < 6) {
        // Straight lines — bezier oscillates wildly with very few points
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(toX(pts[i].ts), toY(pts[i].price));
        }
        return;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const x0 = toX(p0.ts), y0 = toY(p0.price);
        const x1 = toX(p1.ts), y1 = toY(p1.price);
        const x2 = toX(p2.ts), y2 = toY(p2.price);
        const x3 = toX(p3.ts), y3 = toY(p3.price);
        // Adaptive tension: reduce when the curve changes direction sharply
        // (dot product of tangent vectors < 0 = direction reversal → near-zero tension)
        const dx10 = x2 - x0, dy10 = y2 - y0;
        const dx21 = x3 - x1, dy21 = y3 - y1;
        const len10 = Math.sqrt(dx10*dx10 + dy10*dy10) + 1e-6;
        const len21 = Math.sqrt(dx21*dx21 + dy21*dy21) + 1e-6;
        const dot   = (dx10 * dx21 + dy10 * dy21) / (len10 * len21);
        // Tight (0.08) at sharp corners, normal (0.22) at gentle curves
        const t = dot < -0.2 ? 0.08 : dot < 0.1 ? 0.14 : 0.22;
        const cp1x = x1 + (x2 - x0) * t;
        const cp1y = y1 + (y2 - y0) * t;
        const cp2x = x2 - (x3 - x1) * t;
        const cp2y = y2 - (y3 - y1) * t;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
    }

    _drawChart() {
      const s       = this._shadow;
      const canvas  = s.getElementById('fcChartCanvas');
      const emptyEl = s.getElementById('fcChartEmpty');
      const statsEl = s.getElementById('fcChartStats');
      const legendEl = s.getElementById('fcChartLegend');

      if (!this._chartSeries || this._chartSeries.length < 2) {
        canvas.style.display = 'none'; emptyEl.style.display = '';
        statsEl.classList.remove('visible'); legendEl.classList.remove('visible');
        return;
      }

      const now    = Date.now();
      const cutoff = now - this._chartDays * 86400000;
      const pts    = this._chartSeries.filter(p => p.ts >= cutoff);

      if (pts.length < 2) {
        canvas.style.display = 'none'; emptyEl.style.display = '';
        statsEl.classList.remove('visible');
        return;
      }

      canvas.style.display = 'block'; emptyEl.style.display = 'none';
      statsEl.classList.add('visible'); legendEl.classList.add('visible');

      const dpr  = window.devicePixelRatio || 1;
      const wrap = canvas.parentElement;
      const W    = Math.max(wrap?.clientWidth  || 0, 240) || 296;
      const H    = Math.max(wrap?.clientHeight || 0, 100) || 158;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      // Secondary series — BSR (Amazon) and volume bars (eBay)
      const rankPts = (this._rankSeries || []).filter(p => p.ts >= cutoff);
      const qtyPts  = (this._qtySeries  || []).filter(p => p.ts >= cutoff);
      const hasRank = rankPts.length >= 2 && this._market === 'amazon';
      const hasQty  = qtyPts.length  >= 2;

      // Layout — expand right pad for BSR axis, reserve bottom for volume bars
      const PAD  = { t: 10, r: hasRank ? 38 : 8, b: 22, l: 44 };
      const VOL_H = hasQty ? 28 : 0;   // height of volume bar area
      const cw   = W - PAD.l - PAD.r;
      const ch   = H - PAD.t - PAD.b;
      const priceH = ch - (VOL_H > 0 ? VOL_H + 4 : 0);  // price chart height

      const prices = pts.map(p => p.price);
      const maxP   = Math.max(...prices);

      // Y-axis always starts at 0 for clean, non-compressed look
      const dispMin  = 0;
      const dispMax  = maxP * 1.08;  // 8% headroom above max price
      const dispRange = dispMax || 1;

      // X-axis anchored to the selected time window (not data range)
      // → 30d/90d/365d are visually distinct even with sparse data
      const minTs = cutoff;
      const maxTs = now;
      const toX = ts => PAD.l + ((ts - minTs) / (maxTs - minTs)) * cw;
      const toY = p  => PAD.t + priceH - ((p - dispMin) / dispRange) * priceH;

      // ── Y-axis gridlines + labels ────────────────────────────────────────
      const yTicks = this._niceAxisTicks(dispMin, dispMax, 4);
      ctx.font      = '9px "Inter",-apple-system,sans-serif';
      ctx.textAlign = 'right';
      yTicks.forEach(tick => {
        const y = toY(tick);
        if (y < PAD.t || y > PAD.t + priceH + 2) return;
        // Gridline (span full chart width including BSR area)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,.04)';
        ctx.lineWidth   = 1;
        ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y);
        ctx.stroke();
        // Label
        ctx.fillStyle = '#2E3447';
        ctx.fillText('€' + (tick >= 1000 ? (tick/1000).toFixed(1)+'k' : tick.toFixed(tick < 10 ? 2 : 0)), PAD.l - 5, y + 3.5);
      });

      // ── X-axis date labels (evenly spaced in time, not by data index) ────
      const xLabelCount = 3;
      ctx.textAlign = 'center';
      for (let i = 0; i <= xLabelCount; i++) {
        const ts    = minTs + (i / xLabelCount) * (maxTs - minTs);
        const x     = toX(ts);
        const d     = new Date(ts);
        const label = `${d.getDate()}.${d.getMonth()+1}.`;
        ctx.fillStyle = '#2E3447';
        ctx.font      = '8.5px "Inter",-apple-system,sans-serif';
        ctx.fillText(label, x, H - 5);
      }

      // ── Gradient fill ────────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + priceH);
      grad.addColorStop(0, 'rgba(99,102,241,.22)');
      grad.addColorStop(1, 'rgba(99,102,241,.0)');
      ctx.beginPath();
      this._drawCurve(ctx, pts, toX, toY);
      ctx.lineTo(toX(pts[pts.length - 1].ts), PAD.t + priceH);
      ctx.lineTo(toX(pts[0].ts), PAD.t + priceH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Price line ───────────────────────────────────────────────────────
      ctx.beginPath();
      ctx.strokeStyle = '#6366F1';
      ctx.lineWidth   = 1.75;
      ctx.lineJoin    = 'round';
      this._drawCurve(ctx, pts, toX, toY);
      ctx.stroke();

      // ── Median dashed line ───────────────────────────────────────────────
      const sorted = [...prices].sort((a, b) => a - b);
      const mid    = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
      const medY   = toY(median);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(148,163,184,.35)';
      ctx.lineWidth   = 0.75;
      ctx.beginPath(); ctx.moveTo(PAD.l, medY); ctx.lineTo(W - PAD.r, medY); ctx.stroke();
      ctx.restore();

      // ── Min / Max dots ───────────────────────────────────────────────────
      const minP   = Math.min(...prices);
      const minIdx = prices.indexOf(minP);
      const maxIdx = prices.indexOf(maxP);
      [[minIdx, minP, '#EF4444'], [maxIdx, maxP, '#22C55E']].forEach(([idx, p, col]) => {
        ctx.beginPath();
        ctx.arc(toX(pts[idx].ts), toY(p), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = '#0A0A10'; ctx.lineWidth = 1.5; ctx.stroke();
      });

      // ── Current price dot ────────────────────────────────────────────────
      const li = pts.length - 1;
      ctx.beginPath();
      ctx.arc(toX(pts[li].ts), toY(pts[li].price), 4, 0, Math.PI * 2);
      ctx.fillStyle   = '#6366F1'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

      // ── BSR line (Amazon only) ─────────────────────────────────────────────
      if (hasRank) {
        const rankVals = rankPts.map(p => p.value);
        const minR = Math.min(...rankVals), maxR = Math.max(...rankVals);
        const rankRange = maxR - minR || 1;
        // Invert Y: lower rank number = better = drawn higher
        const toYR = r => PAD.t + priceH - ((maxR - r) / rankRange) * priceH;
        // Right Y-axis labels (amber)
        ctx.font = '8px "Inter",-apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(251,191,36,.55)';
        const fmtRank = r => r >= 1000000 ? (r/1000000).toFixed(1)+'M' : r >= 1000 ? Math.round(r/1000)+'k' : String(r);
        [minR, Math.round((minR+maxR)/2), maxR].forEach(r => {
          ctx.fillText(fmtRank(r), W - PAD.r + 3, toYR(r) + 3);
        });
        // BSR label
        ctx.fillText('BSR', W - PAD.r + 3, PAD.t + 8);
        // BSR dashed line
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(251,191,36,.65)';
        ctx.lineWidth   = 1.25;
        ctx.lineJoin    = 'round';
        const rankPtsMapped = rankPts.map(p => ({ ts: p.ts, price: p.value }));
        ctx.beginPath();
        this._drawCurve(ctx, rankPtsMapped, toX, toYR);
        ctx.stroke();
        ctx.restore();
      }

      // ── Volume bars (eBay qty_series) ─────────────────────────────────────
      if (hasQty) {
        const maxQty  = Math.max(...qtyPts.map(p => p.value), 1);
        const volTopY = PAD.t + priceH + 4;
        const barW    = Math.max(2, (cw / Math.max(qtyPts.length, 1)) * 0.65);
        qtyPts.forEach(pt => {
          const x = toX(pt.ts);
          const h = (pt.value / maxQty) * VOL_H;
          ctx.fillStyle = 'rgba(99,102,241,.22)';
          ctx.fillRect(x - barW / 2, volTopY + VOL_H - h, barW, h);
        });
        ctx.font = '7.5px "Inter",-apple-system,sans-serif';
        ctx.fillStyle = '#2E3447';
        ctx.textAlign = 'left';
        ctx.fillText('Verk.', PAD.l + 2, volTopY + 8);
      }

      // Store layout for hover handler
      this._chartLayout = { PAD, cw, ch: priceH, pts, W, H, toX, toY, dispMin, dispMax, dispRange, minTs, maxTs };

      // ── Stats row ────────────────────────────────────────────────────────
      const sum = prices.reduce((a, b) => a + b, 0);
      const avg = sum / prices.length;
      const f   = v => `€${v.toFixed(2)}`;
      s.getElementById('csMin').textContent = f(minP);
      s.getElementById('csAvg').textContent = f(avg);
      s.getElementById('csMax').textContent = f(maxP);

      const trendEl = s.getElementById('csTrend');
      trendEl.className = 'fc-chart-stat-v';
      if (prices.length >= 8) {
        const last7  = prices.slice(-7);
        const prior  = prices.slice(-30, -7);
        if (prior.length >= 3) {
          const avg7  = last7.reduce((a,b)=>a+b,0)  / last7.length;
          const avg23 = prior.reduce((a,b)=>a+b,0)  / prior.length;
          const pct   = ((avg7 - avg23) / avg23) * 100;
          trendEl.textContent = `${pct < 0 ? '↓' : pct > 0 ? '↑' : '→'} ${Math.abs(pct).toFixed(1)}%`;
          trendEl.classList.add(pct < -2 ? 'fc-trend-down' : pct > 2 ? 'fc-trend-up' : '');
        }
      }
    }

    // Generate 3-5 nice round tick values within [min, max]
    _niceAxisTicks(min, max, count) {
      const range   = max - min;
      const rough   = range / count;
      const mag     = Math.pow(10, Math.floor(Math.log10(rough)));
      const nice    = [1, 2, 2.5, 5, 10].map(f => f * mag).find(f => f >= rough) || mag * 10;
      const start   = Math.ceil(min / nice) * nice;
      const ticks   = [];
      for (let t = start; t <= max + nice * 0.01; t += nice) ticks.push(+t.toFixed(10));
      return ticks;
    }

    // ── Chart hover ─────────────────────────────────────────────────────────
    _onChartHover(e) {
      const layout = this._chartLayout;
      if (!layout) return;
      const { PAD, cw, pts, W, H, toX, toY, minTs, maxTs } = layout;
      const s   = this._shadow;
      const tip = s.getElementById('fcChartTip');
      const canvas = s.getElementById('fcChartCanvas');

      const rect  = canvas.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;

      // Only show tooltip when inside the chart area (include volume bar zone at bottom)
      if (mx < PAD.l || mx > W - PAD.r || my < PAD.t || my > H - 4) {
        tip.style.display = 'none'; return;
      }

      // Find closest price data point by time position
      const frac    = (mx - PAD.l) / (cw || 1);
      const hoverTs = minTs + frac * (maxTs - minTs);
      const _closest = (arr) => arr.length === 0 ? null : arr.reduce((best, p, i) =>
        Math.abs(p.ts - hoverTs) < Math.abs(arr[best].ts - hoverTs) ? i : best, 0);

      const idx = _closest(pts);
      const pt  = pts[idx];

      // Position tooltip: flip to left side if too close to right edge
      const tipW  = 110;
      const tipX  = (mx + tipW + 10 < W) ? mx + 8 : mx - tipW - 8;
      tip.style.left    = tipX + 'px';
      tip.style.top     = '8px';
      tip.style.display = 'block';

      const d = new Date(pt.ts);
      s.getElementById('fcChartTipDate').textContent  = `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
      s.getElementById('fcChartTipPrice').textContent = `€${pt.price.toFixed(2)}`;
      s.getElementById('fcChartTipLbl').textContent   = this._market === 'amazon' ? 'Ø Buy Box' : 'VK Median';

      // ── BSR row (Amazon) ──────────────────────────────────────────────────
      const rankPts  = (this._rankSeries || []).filter(p => p.ts >= minTs);
      const rankIdx  = _closest(rankPts);
      const bsrSep   = s.getElementById('fcChartTipBsrSep');
      const bsrRow   = s.getElementById('fcChartTipBsrRow');
      const bsrVal   = s.getElementById('fcChartTipBsr');
      if (rankIdx !== null && this._market === 'amazon') {
        const rv = rankPts[rankIdx].value;
        const fmt = v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'k' : String(v);
        bsrVal.textContent = '#' + fmt(rv);
        bsrSep.style.display = bsrRow.style.display = '';
      } else {
        bsrSep.style.display = bsrRow.style.display = 'none';
      }

      // ── Volume row (eBay qty) ─────────────────────────────────────────────
      const qtyPts  = (this._qtySeries || []).filter(p => p.ts >= minTs);
      const qtyIdx  = _closest(qtyPts);
      const qtySep  = s.getElementById('fcChartTipQtySep');
      const qtyRow  = s.getElementById('fcChartTipQtyRow');
      const qtyVal  = s.getElementById('fcChartTipQty');
      if (qtyIdx !== null && qtyPts.length > 0) {
        qtyVal.textContent = qtyPts[qtyIdx].value + ' Stk.';
        qtySep.style.display = qtyRow.style.display = '';
      } else {
        qtySep.style.display = qtyRow.style.display = 'none';
      }

      // ── Redraw with crosshair + secondary hit dots ────────────────────────
      this._drawChart();
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      const cx = toX(pt.ts);
      const cy = toY(pt.price);
      // Vertical crosshair line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, H - PAD.b);
      ctx.stroke();
      ctx.setLineDash([]);
      // Price highlight dot
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle   = '#6366F1'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      // BSR highlight dot (amber)
      if (rankIdx !== null && this._market === 'amazon' && rankPts.length > 0) {
        const rankVals = rankPts.map(p => p.value);
        const minR = Math.min(...rankVals), maxR = Math.max(...rankVals);
        const rankRange = maxR - minR || 1;
        const toYR = r => PAD.t + layout.ch - ((maxR - r) / rankRange) * layout.ch;
        const rp = rankPts[rankIdx];
        ctx.beginPath();
        ctx.arc(toX(rp.ts), toYR(rp.value), 4, 0, Math.PI * 2);
        ctx.fillStyle   = '#FBbf24'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
    }

    _onChartLeave() {
      const tip = this._shadow.getElementById('fcChartTip');
      if (tip) tip.style.display = 'none';
      this._drawChart(); // redraw without crosshair
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    _updateCachedNote() {
      const el     = this._shadow.getElementById('fcCachedNote');
      if (!this._resultTs) { el.textContent = ''; return; }
      const ageMin = Math.floor((Date.now() - this._resultTs) / 60000);
      el.textContent = ageMin < 1 ? 'Live-Daten' : `Gecacht · vor ${ageMin}m`;
    }

    _setState(state) {
      const s = this._shadow;
      const map = {
        idle:'stIdle', loading:'stLoading', result:'stResult', error:'stError',
        'no-ean':'stNoEan', 'plan-limit':'stPlanLimit', 'pro-required':'stProRequired',
      };
      for (const [key, id] of Object.entries(map)) {
        const el = s.getElementById(id);
        if (el) el.classList.toggle('active', key === state);
      }
      // Sidebar: show/hide inline sections + verdict footer
      const isResult = state === 'result';
      ['fcKpiSection','fcChartSection','fcDetailsSection','fcActionsSection'].forEach(id => {
        const el = s.getElementById(id);
        if (el) el.classList.toggle('visible', isResult);
      });
      const footer = s.getElementById('fcVerdictFooter');
      if (footer) footer.classList.toggle('visible', isResult);
      const productBar = s.getElementById('fcProductBar');
      if (productBar) productBar.classList.toggle('visible', isResult);

      if (isResult) setTimeout(() => this._drawChart(), 60);
      if (!isResult) this._disableDataTabs();
      if (state !== 'no-ean') {
        const btn = s.getElementById('fcScanBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔍 Seite neu scannen'; }
      }
    }

    _setupDrag() { /* sidebar mode — no drag positioning */ }

    // ── Position ─────────────────────────────────────────────────────────────
    _applyPosition(pos) {
      this._position = pos || 'right';
      const isLeft   = pos === 'left';
      const isBottom = pos === 'bottom';
      // Host element positioning
      this.style.setProperty('top',    isBottom ? 'auto'  : '0',     'important');
      this.style.setProperty('bottom', isBottom ? '0'     : 'auto',  'important');
      this.style.setProperty('left',   isLeft || isBottom ? '0' : 'auto', 'important');
      this.style.setProperty('right',  isLeft ? 'auto' : '0',        'important');
      this.style.setProperty('height', isBottom ? '320px' : '100vh', 'important');
      // Explicit width (not 'auto') so the host never covers more than the sidebar area.
      // This prevents the transparent host shell from blocking page clicks when left-docked.
      const wrap    = this._shadow?.querySelector('.fc-wrap');
      const wrapW   = parseInt(wrap?.style.width) || 380;
      this.style.setProperty('width',  isBottom ? '100vw' : (wrapW + 'px'), 'important');

      const resizer = wrap?.querySelector('.fc-resizer');
      if (wrap) {
        wrap.style.height        = isBottom ? '320px' : '100vh';
        wrap.style.width         = isBottom ? '100%'  : (wrap.style.width || '');
        wrap.style.flexDirection = 'column';   // always column — no row layout
        // Borders: right sidebar → left border; left sidebar → right border; bottom → top border
        wrap.style.borderLeft    = isLeft   ? 'none'                  : isBottom ? 'none' : '1px solid #1A1A26';
        wrap.style.borderRight   = isLeft   ? '1px solid #1A1A26'     : 'none';
        wrap.style.borderTop     = isBottom ? '1px solid #1A1A26'     : '';
        // Shadow: right sidebar → left-pointing; left → right-pointing; bottom → upward
        wrap.style.boxShadow     = isBottom ? '0 -8px 32px rgba(0,0,0,.7)'
                                 : isLeft   ? '8px 0 32px rgba(0,0,0,.7), 1px 0 0 rgba(99,102,241,.08)'
                                 :            '';   // CSS default for right
      }
      // Resizer: right-docked → left edge of wrap; left-docked → right edge
      if (resizer) {
        resizer.style.left  = isLeft ? 'auto' : '0';
        resizer.style.right = isLeft ? '0'    : 'auto';
      }
      // Mark position on host element (used by CSS for bottom resizer styling)
      this.dataset.pos = this._position;
      // Update active state of position buttons
      const s = this._shadow;
      if (s) s.querySelectorAll('.fc-pos-btn').forEach(b => b.classList.toggle('active', b.dataset.pos === this._position));
      // Notify content script for body margin update
      const w = isBottom ? (window.innerWidth || 1280) : (parseInt(wrap?.style.width) || 380);
      try { chrome.storage.local.set({ fc_position: pos }); } catch (_) {}
      this.dispatchEvent(new CustomEvent('fc-width-change', { detail: { w, pos: this._position } }));
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    _loadDefaults() {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      chrome.storage.local.get('fc_panel_defaults', data => {
        if (chrome.runtime.lastError) return;
        const d = data?.fc_panel_defaults;
        if (!d) return;
        this._defaults = { market: d.market||'ebay', shipOut: d.shipOut||0, catId: d.catId||'sonstiges' };
        const injectorMarket = this.dataset?.market;
        const marketLocked   = injectorMarket && ['ebay','amazon','kaufland'].includes(injectorMarket);
        if (d.market && d.market !== this._market && !this._identifier && !marketLocked) {
          this._setMarket(d.market, false);
        }
        this._populateSettingsUI();
      });
    }

    _populateSettingsUI() {
      const s = this._shadow;
      const d = this._defaults;
      const si = s.getElementById('setShipOut');
      if (si) si.value = d.shipOut > 0 ? d.shipOut : '';
      const catSel = s.getElementById('setCatId');
      if (catSel && typeof fcBuildCatOptions === 'function') catSel.innerHTML = fcBuildCatOptions(d.catId||'sonstiges');
      s.querySelectorAll('[data-setmarket]').forEach(btn => btn.classList.toggle('active', btn.dataset.setmarket === d.market));
    }

    _saveDefaults() {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      const s      = this._shadow;
      const market = s.querySelector('[data-setmarket].active')?.dataset.setmarket || 'ebay';
      const shipOut = parseFloat(s.getElementById('setShipOut')?.value) || 0;
      const catId   = s.getElementById('setCatId')?.value || 'sonstiges';
      this._defaults = { market, shipOut, catId };
      chrome.storage.local.set({ fc_panel_defaults: this._defaults });
      const msg = s.getElementById('setSavedMsg');
      if (msg) { msg.classList.add('visible'); setTimeout(() => msg.classList.remove('visible'), 1500); }
    }

    // ── Dual-Market Pre-Fetch ─────────────────────────────────────────────
    _fetchEbayChart() {
      const ean = this._identifier;
      if (!ean) return;
      chrome.runtime.sendMessage({ type: 'FLIPCHECK_CHART', ean }, res => {
        if (chrome.runtime.lastError || !res?.ok || !res.data) return;
        const d = res.data;
        if (Array.isArray(d.price_series) && d.price_series.length >= 2) {
          this._loadChartSeries(d);
        }
      });
    }

    _fetchCrossMarket() {
      if (!this._result || !this._identifier) return;
      const d       = this._result;
      const primary = this._market;
      const cross   = primary === 'ebay' ? 'amazon' : 'ebay';
      let crossId   = primary === 'ebay' ? (d.asin || null) : (d.ean || null);

      if (!crossId) {
        const msgType = primary === 'ebay' ? 'EAN_TO_ASIN' : 'ASIN_TO_EAN';
        const param   = primary === 'ebay' ? { ean: this._identifier } : { asin: this._identifier };
        this._crossPending = true;
        chrome.runtime.sendMessage({ type: msgType, ...param }, res => {
          this._crossPending = false;
          if (chrome.runtime.lastError || !res?.ok) return;
          const resolved = primary === 'ebay' ? res.asin : res.ean;
          if (resolved) { this._crossId = resolved; this._fetchForMarket(cross, resolved); }
        });
        return;
      }

      this._crossId = crossId;
      this._fetchForMarket(cross, crossId);
    }

    _fetchForMarket(market, identifier) {
      const ek = this._lastEk;
      if (market === 'amazon') {
        chrome.runtime.sendMessage({
          type:'AMAZON_CHECK', asin:identifier, ean:identifier,
          ek, mode:this._mode, method:this._amazonMethod, shipIn:0, prepFee:0,
        }, res => {
          if (chrome.runtime.lastError || !res?.ok) return;
          this._resultCache.amazon = { data: res.data, ts: Date.now() };
        });
      } else {
        chrome.runtime.sendMessage({
          type:'FLIPCHECK', ean:identifier, ek, mode:this._mode,
        }, res => {
          if (chrome.runtime.lastError || !res?.ok) return;
          this._resultCache.ebay = { data: res.data, ts: Date.now() };
        });
      }
    }
  }

  // ── Manual init fallback ────────────────────────────────────────────────
  function _manualInitPanel(el) {
    if (typeof el.probe === 'function') return;
    console.log('[FC] _manualInitPanel running on', el.tagName, el.id);

    const proto = FlipcheckPanel.prototype;
    Object.getOwnPropertyNames(proto).forEach(name => {
      if (name === 'constructor') return;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc) return;
      if (typeof desc.value === 'function') {
        el[name] = desc.value.bind(el);
      } else if (desc.get || desc.set) {
        Object.defineProperty(el, name, {
          get: desc.get ? desc.get.bind(el) : undefined,
          set: desc.set ? desc.set.bind(el) : undefined,
          configurable: true, enumerable: false,
        });
      }
    });

    const shadow      = el.attachShadow({ mode: 'closed' });
    shadow.innerHTML  = PANEL_HTML;
    // Force positioning via inline style so host-page CSS can't override :host rules
    el.style.setProperty('position', 'fixed',      'important');
    el.style.setProperty('display',  'block',       'important');
    el.style.setProperty('z-index',  '2147483647',  'important');
    el.style.setProperty('top',      '0',           'important');
    el.style.setProperty('right',    '0',           'important');
    el.style.setProperty('bottom',   'auto',        'important');
    el.style.setProperty('height',   '100vh',       'important');
    el.style.setProperty('width',    'auto',        'important');
    el._shadow        = shadow;
    el._market        = 'ebay';
    el._identifier    = null;
    el._mode          = 'mid';
    el._lastEk        = 0;
    el._result        = null;
    el._resultTs      = null;
    el._chartSeries   = null;
    el._rankSeries    = null;
    el._qtySeries     = null;
    el._chartDays     = 30;
    el._chartLayout   = null;
    el._innerTab      = 'check';
    el._alertOpen     = false;
    el._amazonMethod  = 'fba';
    el._defaults      = { market: 'ebay', shipOut: 0, catId: 'sonstiges' };
    el._resultCache   = {};
    el._crossId       = null;
    el._crossPending  = false;
    el._position      = 'right';
    try {
      chrome.storage.local.get(['fc_size', 'fc_position'], res => {
        const savedW = res?.fc_size?.w;
        if (savedW) {
          const wrap = shadow.querySelector('.fc-wrap');
          if (wrap) wrap.style.width = Math.min(640, Math.max(260, savedW)) + 'px';
        }
        el._applyPosition(res?.fc_position || 'right');
      });
    } catch (_) {}
    el._wireEvents();
    el._setupDrag(shadow.getElementById('fcHeader'));

    const dataMarket = el.dataset?.market;
    if (dataMarket && ['ebay','amazon','kaufland'].includes(dataMarket)) {
      el._market = dataMarket;
      shadow.querySelectorAll('.fc-mkt-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.market === dataMarket));
    }

    el._loadDefaults();
    console.log('[FC] panel manually initialised — market:', el._market);
  }

  // ── Init helpers ────────────────────────────────────────────────────────
  function _tryInitExisting() {
    const el = document.getElementById('__fc_panel') || document.querySelector('flipcheck-panel');
    if (el && typeof el.probe !== 'function') _manualInitPanel(el);
  }

  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const target = (node.id === '__fc_panel' || node.tagName === 'FLIPCHECK-PANEL')
          ? node : node.querySelector?.('#__fc_panel, flipcheck-panel');
        if (target) {
          setTimeout(() => { if (typeof target.probe !== 'function') _manualInitPanel(target); }, 100);
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  [200, 500, 1000, 2000, 4000].forEach(ms => setTimeout(_tryInitExisting, ms));

  (function _define(retries) {
    if (typeof customElements !== 'undefined' && customElements) {
      try {
        if (!customElements.get('flipcheck-panel')) {
          customElements.define('flipcheck-panel', FlipcheckPanel);
          console.log('[FC] flipcheck-panel defined OK');
        }
        return;
      } catch (_e) {
        console.warn('[FC] customElements.define failed:', _e.message);
      }
    }
    if (retries > 0) setTimeout(() => _define(retries - 1), 50);
  })(20);

  // ── Panel message hub ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const panel = document.getElementById('__fc_panel');
    if (msg.type === 'GET_PANEL_EAN') {
      sendResponse({ ean: panel?.currentEan || null, market: panel?.currentMarket || 'ebay' });
      return;
    }
    if (msg.type === 'TRIGGER_EAN_SCAN') {
      if (panel && typeof panel.probe === 'function') {
        panel.dispatchEvent(new CustomEvent('fc-manual-ean', { bubbles: true, composed: true }));
      }
      sendResponse({ ok: true }); return;
    }
    if (msg.type === 'TOGGLE_PANEL') {
      if (panel) {
        panel.hasAttribute('data-minimized')
          ? panel.removeAttribute('data-minimized')
          : panel.setAttribute('data-minimized', '');
      }
      sendResponse({ ok: true }); return;
    }
  });
})();
