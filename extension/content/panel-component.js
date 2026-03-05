/* Flipcheck Extension — Floating Panel v3 (Shadow DOM Custom Element)
 * v3: Market toggle (eBay/Amazon), 3 inner tabs (Check/Chart/Details),
 *     canvas price chart, Amazon FBA details, drag + minimize.
 */

(function () {
  // Safe guard — customElements may be null on some SPAs during init
  if (window._fcPanelDef) return;
  window._fcPanelDef = true;
  console.debug('[FC] panel-component.js loaded, customElements available:', typeof customElements, !!customElements);

  // ── CSS ────────────────────────────────────────────────────────────────────
  const PANEL_CSS = `
    :host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    :host([data-minimized]) .fc-body-wrap { display: none; }
    :host([data-minimized]) .fc-itabs-wrap { display: none; }
    :host([data-minimized]) .fc-wrap { width: 44px; border-radius: 22px; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .fc-wrap {
      background: #111118;
      border: 1px solid #2E2E42;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.7);
      width: 292px;
      overflow: hidden;
      transition: width .2s, border-radius .2s;
    }

    /* ── HEADER ── */
    .fc-header {
      background: #16161F;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: move;
      user-select: none;
      border-bottom: 1px solid #1E1E2E;
    }
    .fc-logo { color: #6366F1; font-weight: 800; font-size: 11px; letter-spacing: .06em; flex-shrink: 0; }

    .fc-market-row { display: flex; gap: 3px; flex-shrink: 0; }
    .fc-mkt-btn {
      background: #1E1E2E; border: 1px solid #2E2E42; border-radius: 4px;
      color: #475569; cursor: pointer; font-size: 9px; font-weight: 700;
      letter-spacing: .03em; line-height: 1; padding: 3px 6px;
      transition: background .15s, color .15s, border-color .15s;
    }
    .fc-mkt-btn:hover { color: #94A3B8; border-color: #6366F1; }
    .fc-mkt-btn.active { background: #6366F1; border-color: #6366F1; color: #fff; }

    .fc-mode-btns { display: flex; gap: 2px; flex-shrink: 0; }
    .fc-mode-btn {
      background: #1E1E2E; border: 1px solid #2E2E42; border-radius: 4px;
      color: #475569; cursor: pointer; font-size: 9px; font-weight: 700;
      letter-spacing: .04em; line-height: 1; padding: 3px 5px;
      transition: background .15s, color .15s, border-color .15s;
    }
    .fc-mode-btn:hover { color: #94A3B8; border-color: #6366F1; }
    .fc-mode-btn.active { background: #6366F1; border-color: #6366F1; color: #fff; }

    .fc-id-tag {
      font-size: 9px; color: #334155; font-family: monospace;
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .fc-btn-icon {
      background: none; border: none; color: #475569; cursor: pointer;
      font-size: 13px; line-height: 1; padding: 0 2px; flex-shrink: 0; transition: color .15s;
    }
    .fc-btn-icon:hover { color: #94A3B8; }

    /* ── INNER TABS ── */
    .fc-itabs-wrap {
      display: flex; background: #16161F; border-bottom: 1px solid #1E1E2E;
    }
    .fc-itab {
      flex: 1; background: none; border: none; border-bottom: 2px solid transparent;
      color: #475569; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 7px 0; transition: color .15s, border-color .15s; text-align: center;
    }
    .fc-itab:hover:not(:disabled) { color: #94A3B8; }
    .fc-itab.active { color: #6366F1; border-bottom-color: #6366F1; }
    .fc-itab:disabled { opacity: .3; cursor: default; }

    /* ── TAB PANES ── */
    .fc-tab-pane { display: none; padding: 12px; }
    .fc-tab-pane.active { display: block; }

    /* EK row */
    .fc-ek-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .fc-ek-inp {
      flex: 1; background: #16161F; border: 1px solid #2E2E42; border-radius: 6px;
      color: #F1F5F9; font-size: 13px; padding: 6px 10px; outline: none; transition: border-color .15s;
    }
    .fc-ek-inp::placeholder { color: #334155; }
    .fc-ek-inp:focus { border-color: #6366F1; }
    .fc-ek-inp.autofilled { border-color: #10B981; }
    .fc-check-btn {
      background: #6366F1; color: #fff; border: none; border-radius: 6px;
      font-size: 12px; font-weight: 700; padding: 6px 14px; cursor: pointer;
      white-space: nowrap; transition: background .15s;
    }
    .fc-check-btn:hover { background: #5558E8; }
    .fc-check-btn:disabled { opacity: .5; cursor: not-allowed; }

    /* States */
    .fc-state { display: none; }
    .fc-state.active { display: block; }
    .fc-loading { color: #475569; font-size: 12px; text-align: center; padding: 16px 0; }
    .fc-loading::after {
      content: ''; display: inline-block; width: 12px; height: 12px;
      border: 2px solid #2E2E42; border-top-color: #6366F1; border-radius: 50%;
      animation: fc-spin .7s linear infinite; margin-left: 6px; vertical-align: middle;
    }
    @keyframes fc-spin { to { transform: rotate(360deg); } }
    .fc-no-ean { color: #475569; font-size: 11px; text-align: center; padding: 10px 0; line-height: 1.5; }
    .fc-error-wrap { text-align: center; padding: 10px 0; }
    .fc-error-msg { color: #EF4444; font-size: 11px; margin-bottom: 8px; }
    .fc-retry-btn {
      background: #16161F; border: 1px solid #2E2E42; border-radius: 6px;
      color: #94A3B8; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 4px 12px; transition: border-color .15s, color .15s;
    }
    .fc-retry-btn:hover { border-color: #6366F1; color: #F1F5F9; }

    .fc-scan-btn {
      display: block; width: 100%; margin-top: 8px;
      background: #1E1E2E; border: 1px solid #2E2E42; border-radius: 6px;
      color: #94A3B8; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 6px 0; transition: border-color .15s, color .15s;
    }
    .fc-scan-btn:hover:not(:disabled) { border-color: #6366F1; color: #F1F5F9; }
    .fc-scan-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Result */
    .fc-verdict-badge {
      font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 8px;
      display: inline-block; margin-bottom: 8px; letter-spacing: .04em;
    }
    .fc-title {
      font-size: 10px; color: #475569; margin-bottom: 8px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .fc-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
    .fc-kpi { background: #16161F; border-radius: 6px; padding: 6px 8px; }
    .fc-kpi-v { display: block; font-size: 13px; font-weight: 700; color: #F1F5F9; font-variant-numeric: tabular-nums; }
    .fc-kpi-l { display: block; font-size: 10px; color: #475569; margin-top: 1px; }
    .fc-kpi-v.green  { color: #10B981; }
    .fc-kpi-v.red    { color: #EF4444; }
    .fc-kpi-v.yellow { color: #F59E0B; }
    .fc-velocity-bar { height: 4px; border-radius: 2px; background: #1E1E2E; margin-top: 5px; overflow: hidden; }
    .fc-velocity-fill { height: 100%; border-radius: 2px; transition: width .4s ease; }

    .fc-actions { display: flex; gap: 6px; }
    .fc-action-btn {
      flex: 1; background: #16161F; color: #94A3B8; border: 1px solid #2E2E42;
      border-radius: 6px; font-size: 11px; font-weight: 600; padding: 5px 8px;
      cursor: pointer; transition: border-color .15s, color .15s; text-align: center; white-space: nowrap;
    }
    .fc-action-btn:hover { border-color: #6366F1; color: #F1F5F9; }
    .fc-action-btn.saved { border-color: #10B981; color: #10B981; cursor: default; }

    .fc-alert-form {
      display: none; margin-top: 8px; padding: 10px;
      background: #16161F; border: 1px solid #2E2E42; border-radius: 8px;
    }
    .fc-alert-form.visible { display: block; }
    .fc-alert-label { display: block; font-size: 10px; color: #475569; margin-bottom: 5px; }
    .fc-alert-row { display: flex; gap: 6px; }
    .fc-alert-inp {
      flex: 1; background: #111118; border: 1px solid #2E2E42; border-radius: 5px;
      color: #F1F5F9; font-size: 12px; padding: 5px 8px; outline: none; transition: border-color .15s;
    }
    .fc-alert-inp:focus { border-color: #6366F1; }
    .fc-alert-inp::placeholder { color: #334155; }
    .fc-alert-submit {
      background: #6366F1; border: none; border-radius: 5px; color: #fff;
      cursor: pointer; font-size: 11px; font-weight: 700; padding: 5px 10px; white-space: nowrap;
    }
    .fc-alert-feedback { display: none; font-size: 10px; margin-top: 5px; }
    .fc-cached-note { font-size: 9px; color: #334155; text-align: right; margin-top: 6px; min-height: 12px; }

    /* Upgrade */
    .fc-upgrade-wrap { text-align: center; padding: 16px 8px 10px; }
    .fc-upgrade-icon { font-size: 22px; margin-bottom: 6px; }
    .fc-upgrade-title { font-size: 13px; font-weight: 700; color: #F1F5F9; margin-bottom: 4px; }
    .fc-upgrade-text  { font-size: 11px; color: #475569; margin-bottom: 12px; line-height: 1.5; }
    .fc-upgrade-btn {
      display: inline-block; background: #6366F1; color: #fff; border-radius: 6px;
      font-size: 12px; font-weight: 700; padding: 7px 18px; text-decoration: none; cursor: pointer;
    }
    .fc-upgrade-btn:hover { background: #5558E8; }

    /* ── CHART TAB ── */
    .fc-chart-ranges { display: flex; gap: 4px; margin-bottom: 8px; }
    .fc-chart-range-btn {
      background: #16161F; border: 1px solid #2E2E42; border-radius: 4px;
      color: #475569; cursor: pointer; font-size: 10px; font-weight: 600;
      padding: 3px 8px; transition: background .15s, color .15s, border-color .15s;
    }
    .fc-chart-range-btn:hover { color: #94A3B8; border-color: #6366F1; }
    .fc-chart-range-btn.active { background: #6366F1; border-color: #6366F1; color: #fff; }
    .fc-chart-canvas-wrap { position: relative; height: 100px; margin-bottom: 8px; }
    .fc-chart-canvas { display: block; width: 100%; height: 100%; }
    .fc-chart-empty { color: #334155; font-size: 11px; text-align: center; padding: 30px 0; }
    .fc-chart-stats { display: none; gap: 6px; }
    .fc-chart-stats.visible { display: flex; }
    .fc-chart-stat { flex: 1; background: #16161F; border-radius: 6px; padding: 5px 7px; text-align: center; }
    .fc-chart-stat-v { display: block; font-size: 11px; font-weight: 700; color: #F1F5F9; font-variant-numeric: tabular-nums; }
    .fc-chart-stat-l { display: block; font-size: 9px; color: #475569; margin-top: 1px; }

    /* ── DETAILS TAB ── */
    .fc-det-section { margin-bottom: 10px; }
    .fc-det-title { font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
    .fc-det-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 8px; }
    .fc-det-cell { background: #16161F; border-radius: 6px; padding: 5px 8px; }
    .fc-det-v { display: block; font-size: 12px; font-weight: 700; color: #F1F5F9; font-variant-numeric: tabular-nums; }
    .fc-det-l { display: block; font-size: 9px; color: #475569; margin-top: 1px; }
    .fc-det-inp-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .fc-det-inp-label { font-size: 10px; color: #475569; flex-shrink: 0; min-width: 90px; }
    .fc-det-inp {
      flex: 1; background: #16161F; border: 1px solid #2E2E42; border-radius: 5px;
      color: #F1F5F9; font-size: 12px; padding: 4px 8px; outline: none; transition: border-color .15s;
    }
    .fc-det-inp:focus { border-color: #6366F1; }
    .fc-det-inp::placeholder { color: #334155; }
    .fc-det-toggle { display: flex; gap: 3px; flex: 1; }
    .fc-det-toggle-btn {
      flex: 1; background: #16161F; border: 1px solid #2E2E42; border-radius: 4px;
      color: #475569; cursor: pointer; font-size: 10px; font-weight: 600;
      padding: 4px 6px; text-align: center; transition: background .15s, color .15s, border-color .15s;
    }
    .fc-det-toggle-btn.active { background: #6366F1; border-color: #6366F1; color: #fff; }
    .fc-det-recalc-btn {
      width: 100%; background: #1E1E2E; border: 1px solid #2E2E42; border-radius: 6px;
      color: #94A3B8; cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 6px 0; transition: border-color .15s, color .15s; margin-top: 4px;
    }
    .fc-det-recalc-btn:hover { border-color: #6366F1; color: #F1F5F9; }
    .fc-det-empty { color: #334155; font-size: 11px; text-align: center; padding: 24px 0; }
  `;

  // ── HTML ───────────────────────────────────────────────────────────────────
  const PANEL_HTML = `
    <style>${PANEL_CSS}</style>
    <div class="fc-wrap">

      <!-- Header -->
      <div class="fc-header" id="fcHeader">
        <span class="fc-logo">▲ FC</span>
        <div class="fc-market-row">
          <button class="fc-mkt-btn active" data-market="ebay">eBay</button>
          <button class="fc-mkt-btn" data-market="amazon">Amz</button>
        </div>
        <div class="fc-mode-btns">
          <button class="fc-mode-btn" data-mode="low" title="Günstigster">L</button>
          <button class="fc-mode-btn active" data-mode="mid" title="Median">M</button>
          <button class="fc-mode-btn" data-mode="high" title="Höchster">H</button>
        </div>
        <span class="fc-id-tag" id="fcIdTag"></span>
        <button class="fc-btn-icon" id="fcMinBtn" title="Minimieren">—</button>
        <button class="fc-btn-icon" id="fcCloseBtn" title="Schließen">✕</button>
      </div>

      <!-- Inner tab bar -->
      <div class="fc-itabs-wrap">
        <button class="fc-itab active" data-itab="check">Check</button>
        <button class="fc-itab" data-itab="chart" id="tabChart" disabled>Chart</button>
        <button class="fc-itab" data-itab="details" id="tabDetails" disabled>Details</button>
      </div>

      <div class="fc-body-wrap">

        <!-- ── CHECK TAB ── -->
        <div class="fc-tab-pane active" id="paneCheck">
          <div class="fc-ek-row">
            <input class="fc-ek-inp" id="fcEkInp" type="number" step="0.01" min="0" placeholder="EK (€)" />
            <button class="fc-check-btn" id="fcCheckBtn">→</button>
          </div>
          <div class="fc-ek-row" id="fcPrepRow" style="display:none">
            <input class="fc-ek-inp" id="fcPrepInp" type="number" step="0.01" min="0" placeholder="PREP (€/Stk.)" style="flex:1" />
            <span style="font-size:9px;color:#475569;white-space:nowrap;line-height:1.2;max-width:52px;text-align:right">Labeling/<br>Bagging</span>
          </div>

          <div class="fc-state active" id="stIdle">
            <div class="fc-no-ean">EAN / ASIN eingeben und prüfen.</div>
          </div>
          <div class="fc-state" id="stLoading">
            <div class="fc-loading">Prüfe Marktdaten</div>
          </div>
          <div class="fc-state" id="stResult">
            <div id="fcVerdictBadge" class="fc-verdict-badge">—</div>
            <div id="fcTitle" class="fc-title"></div>
            <div class="fc-kpis">
              <div class="fc-kpi">
                <span class="fc-kpi-v" id="kvVk">—</span>
                <span class="fc-kpi-l" id="kvVkLabel">Median VK</span>
              </div>
              <div class="fc-kpi">
                <span class="fc-kpi-v red" id="kvFee">—</span>
                <span class="fc-kpi-l" id="kvFeeLabel">eBay Gebühr</span>
              </div>
              <div class="fc-kpi">
                <span class="fc-kpi-v" id="kvProfit">—</span>
                <span class="fc-kpi-l">Profit</span>
              </div>
              <div class="fc-kpi">
                <span class="fc-kpi-v" id="kvMargin">—</span>
                <span class="fc-kpi-l">Marge</span>
              </div>
              <div class="fc-kpi" style="grid-column: 1 / -1;">
                <span class="fc-kpi-v" id="kvSales">—</span>
                <span class="fc-kpi-l" id="kvSalesLabel">Verk./30d</span>
                <div class="fc-velocity-bar">
                  <div class="fc-velocity-fill" id="fcVelocityFill"></div>
                </div>
              </div>
            </div>
            <div class="fc-actions">
              <button class="fc-action-btn" id="fcInvBtn">+ Inventar</button>
              <button class="fc-action-btn" id="fcAlertBtn">🔔 Alarm</button>
            </div>
            <div class="fc-alert-form" id="fcAlertForm">
              <span class="fc-alert-label">Zielpreis-Alarm</span>
              <div class="fc-alert-row">
                <input class="fc-alert-inp" id="fcAlertInp" type="number" step="0.01" min="0" placeholder="Zielpreis (€)" />
                <button class="fc-alert-submit" id="fcAlertSubmit">Setzen</button>
              </div>
              <div class="fc-alert-feedback" id="fcAlertFeedback"></div>
            </div>
            <div class="fc-cached-note" id="fcCachedNote"></div>
          </div>
          <div class="fc-state" id="stError">
            <div class="fc-error-wrap">
              <div class="fc-error-msg">Fehler — Backend nicht erreichbar.</div>
              <button class="fc-retry-btn" id="fcRetryBtn">↺ Erneut versuchen</button>
            </div>
          </div>
          <div class="fc-state" id="stNoEan">
            <div class="fc-no-ean">Kein EAN / ASIN erkannt.<br/><span style="color:#334155;font-size:10px">Bitte oben eingeben.</span></div>
            <button class="fc-scan-btn" id="fcScanBtn">🔍 EAN scannen</button>
          </div>
          <div class="fc-state" id="stPlanLimit">
            <div class="fc-upgrade-wrap">
              <div class="fc-upgrade-icon">🔒</div>
              <div class="fc-upgrade-title">Tageslimit erreicht</div>
              <div class="fc-upgrade-text">Dein tägliches Gratis-Kontingent ist verbraucht.</div>
              <a class="fc-upgrade-btn" id="fcUpgradeBtn" href="https://whop.com/flipcheck" target="_blank" rel="noopener">⚡ Upgrade auf PRO</a>
            </div>
          </div>
        </div>

        <!-- ── CHART TAB ── -->
        <div class="fc-tab-pane" id="paneChart">
          <div class="fc-chart-ranges">
            <button class="fc-chart-range-btn active" data-days="30">30T</button>
            <button class="fc-chart-range-btn" data-days="90">90T</button>
            <button class="fc-chart-range-btn" data-days="365">1J</button>
          </div>
          <div class="fc-chart-canvas-wrap">
            <canvas class="fc-chart-canvas" id="fcChartCanvas"></canvas>
            <div class="fc-chart-empty" id="fcChartEmpty">Noch keine Daten.</div>
          </div>
          <div class="fc-chart-stats" id="fcChartStats">
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csMin">—</span><span class="fc-chart-stat-l">Min</span></div>
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csAvg">—</span><span class="fc-chart-stat-l">Avg</span></div>
            <div class="fc-chart-stat"><span class="fc-chart-stat-v" id="csMax">—</span><span class="fc-chart-stat-l">Max</span></div>
          </div>
        </div>

        <!-- ── DETAILS TAB ── -->
        <div class="fc-tab-pane" id="paneDetails">
          <!-- eBay details -->
          <div id="detEbay">
            <div class="fc-det-section">
              <div class="fc-det-title">eBay Marktdaten</div>
              <div class="fc-det-grid">
                <div class="fc-det-cell"><span class="fc-det-v" id="deListings">—</span><span class="fc-det-l">Aktive Angebote</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="deSellers">—</span><span class="fc-det-l">Verkäufer</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="deAvgShip">—</span><span class="fc-det-l">Ø Versand</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="deDtc">—</span><span class="fc-det-l">Ø Tage bis Verk.</span></div>
              </div>
            </div>
            <div class="fc-det-section">
              <div class="fc-det-title">Kalkulation</div>
              <div class="fc-det-inp-row">
                <span class="fc-det-inp-label">Versand VK (€)</span>
                <input class="fc-det-inp" id="deShipOut" type="number" step="0.01" min="0" placeholder="0.00" />
              </div>
              <button class="fc-det-recalc-btn" id="deRecalcBtn">↺ Neu berechnen</button>
            </div>
          </div>

          <!-- Amazon details -->
          <div id="detAmazon" style="display:none">
            <div class="fc-det-section">
              <div class="fc-det-title">Amazon Marktdaten</div>
              <div class="fc-det-grid">
                <div class="fc-det-cell"><span class="fc-det-v" id="daBoxPrice">—</span><span class="fc-det-l">Buy Box</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daBoxAvg30">—</span><span class="fc-det-l">Ø 30T Buy Box</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daRefFee">—</span><span class="fc-det-l">Referral Fee</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daFbaFee">—</span><span class="fc-det-l">FBA Fee</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daPrepFee">—</span><span class="fc-det-l">PREP Gebühr</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daOffers">—</span><span class="fc-det-l">Angebote (neu)</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daRank">—</span><span class="fc-det-l">Sales Rank</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daSales">—</span><span class="fc-det-l">Est. Verkäufe/30d</span></div>
                <div class="fc-det-cell"><span class="fc-det-v" id="daBsrDrops">—</span><span class="fc-det-l">BSR Drops/30d</span></div>
                <div class="fc-det-cell" style="grid-column:1/-1"><span class="fc-det-v" id="daVariants">—</span><span class="fc-det-l">Varianten</span></div>
              </div>
            </div>
            <div class="fc-det-section">
              <div class="fc-det-title">Versandmethode</div>
              <div class="fc-det-inp-row">
                <span class="fc-det-inp-label">Methode</span>
                <div class="fc-det-toggle">
                  <button class="fc-det-toggle-btn active" data-method="fba">FBA</button>
                  <button class="fc-det-toggle-btn" data-method="fbm">FBM</button>
                </div>
              </div>
              <div class="fc-det-inp-row" id="daShipInRow" style="display:none">
                <span class="fc-det-inp-label">Versand EK (€)</span>
                <input class="fc-det-inp" id="daShipIn" type="number" step="0.01" min="0" placeholder="0.00" />
              </div>
              <button class="fc-det-recalc-btn" id="daRecalcBtn">↺ Neu berechnen</button>
            </div>
          </div>

          <div class="fc-det-empty" id="detEmpty">Erst prüfen, dann Details.</div>
        </div>

      </div><!-- /fc-body-wrap -->
    </div><!-- /fc-wrap -->
  `;

  // ── Class ──────────────────────────────────────────────────────────────────
  class FlipcheckPanel extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'closed' });
      shadow.innerHTML = PANEL_HTML;
      this._shadow        = shadow;
      this._market        = 'ebay';   // 'ebay' | 'amazon'
      this._identifier    = null;     // EAN or ASIN
      this._mode          = 'mid';    // 'low' | 'mid' | 'high'
      this._lastEk        = 0;
      this._result        = null;
      this._resultTs      = null;
      this._chartSeries   = null;     // [{ts, price}]
      this._chartDays     = 30;
      this._innerTab      = 'check';
      this._alertOpen     = false;
      this._amazonMethod  = 'fba';
      try {
        const pos = JSON.parse(sessionStorage.getItem('fc_pos') || '{}');
        if (pos.right  != null) this.style.right  = pos.right  + 'px';
        if (pos.bottom != null) this.style.bottom = pos.bottom + 'px';
      } catch (_) {}
      this._wireEvents();
      this._setupDrag(shadow.getElementById('fcHeader'));
    }

    // ── Lifecycle callbacks ───────────────────────────────────────────────────
    disconnectedCallback() {
      // Fired by the browser when this element is removed from the DOM (e.g. by
      // Next.js SSR hydration replacing <body>). Content scripts listen for this
      // event to immediately re-attach the panel — no polling interval needed.
      this.dispatchEvent(new CustomEvent('fc-disconnected', { bubbles: false }));
    }

    // ── Public API ────────────────────────────────────────────────────────────
    probe(identifier, market) {
      if (market) this._setMarket(market, false);
      this._identifier = identifier;
      this._shadow.getElementById('fcIdTag').textContent = identifier || '';
      this._setState('loading');
      this._fetchResult();
      this._autoFillPagePrice();
    }

    _autoFillPagePrice() {
      if (typeof detectPagePrice !== 'function') return;
      const inp = this._shadow.getElementById('fcEkInp');
      // Don't overwrite a value the user already entered manually
      if (parseFloat(inp?.value) > 0) return;
      const _try = () => {
        if (parseFloat(inp?.value) > 0) return; // filled in the meantime
        const price = detectPagePrice();
        if (price > 0) this.autofillEk(price);
      };
      // Immediate attempt (SSR pages already rendered), then retry for SPA hydration
      _try();
      setTimeout(_try, 600);
      setTimeout(_try, 1800);
    }

    setIdentifier(identifier, market) {
      if (market) this._setMarket(market, false);
      this._identifier = identifier;
      this._shadow.getElementById('fcIdTag').textContent = identifier || '';
      this._setState('idle');
    }

    // Backward compat
    setEan(ean) { this.setIdentifier(ean, 'ebay'); }
    get currentEan()    { return this._identifier; }
    get currentMarket() { return this._market || 'ebay'; }

    setMarket(market) { this._setMarket(market, false); }
    setState(s) { this._setState(s); }

    autofillEk(price) {
      const inp = this._shadow.getElementById('fcEkInp');
      inp.value = Number(price).toFixed(2);
      inp.classList.add('autofilled');
      setTimeout(() => inp.classList.remove('autofilled'), 1200);
    }

    // ── Events ────────────────────────────────────────────────────────────────
    _wireEvents() {
      const s = this._shadow;

      s.getElementById('fcCloseBtn').addEventListener('click', () => this.remove());
      s.getElementById('fcMinBtn').addEventListener('click', () => {
        this.hasAttribute('data-minimized')
          ? this.removeAttribute('data-minimized')
          : this.setAttribute('data-minimized', '');
      });

      // Market toggle
      s.querySelectorAll('.fc-mkt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.market !== this._market) this._setMarket(btn.dataset.market, true);
        });
      });

      // Mode buttons
      s.querySelectorAll('.fc-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.mode !== this._mode) {
            this._mode = btn.dataset.mode;
            s.querySelectorAll('.fc-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === this._mode));
            if (this._identifier) { this._setState('loading'); this._fetchResult(); }
          }
        });
      });

      // Inner tabs
      s.querySelectorAll('.fc-itab').forEach(tab => {
        tab.addEventListener('click', () => {
          if (!tab.disabled) this._setInnerTab(tab.dataset.itab);
        });
      });

      // Check
      s.getElementById('fcCheckBtn').addEventListener('click', () => this._runCheck());
      s.getElementById('fcEkInp').addEventListener('keydown', e => { if (e.key === 'Enter') this._runCheck(); });
      s.getElementById('fcRetryBtn').addEventListener('click', () => {
        if (!this._identifier) return;
        this._setState('loading');
        this._fetchResult();
      });

      // Scan EAN button — dispatches event to content script which runs the extractor
      const scanBtn = s.getElementById('fcScanBtn');
      if (scanBtn) {
        scanBtn.addEventListener('click', () => {
          scanBtn.disabled = true;
          scanBtn.textContent = '⟳ Scanne…';
          this.dispatchEvent(new CustomEvent('fc-manual-ean', { bubbles: true, composed: true }));
          // Auto-reset if content script finds nothing within 6 s
          setTimeout(() => {
            if (scanBtn.disabled) {
              scanBtn.disabled = false;
              scanBtn.textContent = '🔍 EAN scannen';
            }
          }, 6000);
        });
      }

      // Alert
      s.getElementById('fcAlertBtn').addEventListener('click', () => this._toggleAlertForm());
      s.getElementById('fcAlertSubmit').addEventListener('click', () => this._submitAlert());
      s.getElementById('fcAlertInp').addEventListener('keydown', e => { if (e.key === 'Enter') this._submitAlert(); });

      // Chart ranges
      s.querySelectorAll('.fc-chart-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const days = Number(btn.dataset.days);
          if (days !== this._chartDays) {
            this._chartDays = days;
            s.querySelectorAll('.fc-chart-range-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
            this._drawChart();
          }
        });
      });

      // Details: eBay recalc
      s.getElementById('deRecalcBtn').addEventListener('click', () => this._recalcEbay());

      // Details: Amazon method toggle
      s.querySelectorAll('.fc-det-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._amazonMethod = btn.dataset.method;
          s.querySelectorAll('.fc-det-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.method === this._amazonMethod));
          s.getElementById('daShipInRow').style.display = this._amazonMethod === 'fbm' ? 'flex' : 'none';
        });
      });

      // Details: Amazon recalc
      s.getElementById('daRecalcBtn').addEventListener('click', () => this._recalcAmazon());
    }

    // ── Market ────────────────────────────────────────────────────────────────
    _setMarket(market, refetch) {
      this._market = market;
      const s = this._shadow;
      s.querySelectorAll('.fc-mkt-btn').forEach(b => b.classList.toggle('active', b.dataset.market === market));
      // KPI labels
      s.getElementById('kvVkLabel').textContent    = market === 'amazon' ? 'Buy Box'    : 'Median VK';
      s.getElementById('kvFeeLabel').textContent   = market === 'amazon' ? 'Ref + FBA'  : 'eBay Gebühr';
      s.getElementById('kvSalesLabel').textContent = market === 'amazon' ? 'Sales Rank' : 'Verk./30d';
      // Show PREP fee row for Amazon only
      const prepRow = s.getElementById('fcPrepRow');
      if (prepRow) prepRow.style.display = market === 'amazon' ? '' : 'none';
      // Details sections
      if (this._result) {
        s.getElementById('detEbay').style.display    = market === 'ebay'    ? '' : 'none';
        s.getElementById('detAmazon').style.display  = market === 'amazon'  ? '' : 'none';
        s.getElementById('detEmpty').style.display   = 'none';
      }
      if (refetch && this._identifier) { this._setState('loading'); this._fetchResult(); }
    }

    // ── Inner Tabs ────────────────────────────────────────────────────────────
    _setInnerTab(tab) {
      this._innerTab = tab;
      const s = this._shadow;
      const paneMap = { check: 'paneCheck', chart: 'paneChart', details: 'paneDetails' };
      s.querySelectorAll('.fc-itab').forEach(t => t.classList.toggle('active', t.dataset.itab === tab));
      s.querySelectorAll('.fc-tab-pane').forEach(p => p.classList.toggle('active', p.id === paneMap[tab]));
      if (tab === 'chart') setTimeout(() => this._drawChart(), 30);
    }

    _disableDataTabs() {
      const s = this._shadow;
      s.getElementById('tabChart').disabled   = true;
      s.getElementById('tabDetails').disabled = true;
      if (this._innerTab !== 'check') this._setInnerTab('check');
    }

    _enableDataTabs() {
      this._shadow.getElementById('tabChart').disabled   = false;
      this._shadow.getElementById('tabDetails').disabled = false;
    }

    // ── Check ─────────────────────────────────────────────────────────────────
    _runCheck() {
      this._lastEk = parseFloat(this._shadow.getElementById('fcEkInp').value) || 0;
      if (!this._identifier) { this._setState('no-ean'); return; }
      this._setState('loading');
      this._fetchResult();
    }

    _fetchResult() {
      const s = this._shadow;
      const ekVal = parseFloat(s.getElementById('fcEkInp').value);
      if (!isNaN(ekVal)) this._lastEk = ekVal;
      this._disableDataTabs();

      if (this._market === 'amazon') {
        const prepVal = parseFloat(s.getElementById('fcPrepInp')?.value) || 0;
        chrome.runtime.sendMessage({
          type:    'AMAZON_CHECK',
          asin:    this._identifier,
          ean:     this._identifier,
          ek:      this._lastEk,
          mode:    this._mode,
          method:  this._amazonMethod,
          shipIn:  parseFloat(s.getElementById('daShipIn')?.value) || 0,
          prepFee: prepVal,
        }, res => {
          if (chrome.runtime.lastError) { this._setState('error'); return; }
          this._handleApiResponse(res);
        });
      } else {
        chrome.runtime.sendMessage({
          type: 'FLIPCHECK',
          ean:  this._identifier,
          ek:   this._lastEk,
          mode: this._mode,
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
          this._setState('error');
        }
        return;
      }
      this._result   = res.data;
      this._resultTs = Date.now();
      this._renderResult(res.data);
      this._populateDetails(res.data);
      this._loadChartSeries(res.data);
      this._checkInventoryStatus(this._identifier);
    }

    // ── Render Result ─────────────────────────────────────────────────────────
    _renderResult(d) {
      const s = this._shadow;
      const fmt    = v => v != null && !isNaN(v) ? `€${Number(v).toFixed(2)}` : '—';
      const fmtPct = v => v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%`  : '—';

      // Verdict badge
      const vc    = { BUY: '#10B981', HOLD: '#F59E0B', SKIP: '#EF4444' };
      const color = vc[d.verdict] || '#475569';
      const badge = s.getElementById('fcVerdictBadge');
      badge.textContent = d.verdict || '—';
      badge.style.cssText = `background:${color}22;color:${color};border:1px solid ${color}44`;

      // Title
      const titleEl = s.getElementById('fcTitle');
      titleEl.textContent  = d.title ? d.title.slice(0, 72) : '';
      titleEl.style.display = d.title ? 'block' : 'none';

      // KPIs
      if (this._market === 'amazon') {
        s.getElementById('kvVk').textContent = d.buy_box ? fmt(d.buy_box) : fmt(d.sell_price_median);
        const totalFee = (d.referral_fee ?? 0) + (d.fba_fee ?? 0);
        s.getElementById('kvFee').textContent = totalFee > 0 ? `-€${totalFee.toFixed(2)}` : '—';
        // Sales label: est. monthly sales + BSR drops hint
        const salesStr = d.sales_30d != null ? `~${d.sales_30d}` : '—';
        const bsrStr   = d.bsr_drops_30d != null ? ` · ${d.bsr_drops_30d}↓` : '';
        s.getElementById('kvSales').textContent = salesStr + bsrStr;
        s.getElementById('kvSalesLabel').textContent = 'Est. Verk./30d · BSR↓';
        // Velocity bar based on estimated sales
        this._renderVelocityBar(d.sales_30d);
      } else {
        s.getElementById('kvVk').textContent = fmt(d.sell_price_median);
        let feeAmt = d.fee ?? d.ebay_fee ?? null;
        if (feeAmt == null && d.sell_price_median != null) {
          feeAmt = typeof fcCalcEbayFee === 'function'
            ? fcCalcEbayFee(Number(d.sell_price_median), 'sonstiges')
            : Number(d.sell_price_median) * 0.13;
        }
        s.getElementById('kvFee').textContent = feeAmt != null ? `-€${Number(feeAmt).toFixed(2)}` : '—';
        const sales = d.sales_30d != null ? Number(d.sales_30d) : null;
        s.getElementById('kvSales').textContent = sales != null ? String(sales) : '—';
        this._renderVelocityBar(sales);
      }

      const kvProfit = s.getElementById('kvProfit');
      kvProfit.textContent = fmt(d.profit_median);
      kvProfit.className   = 'fc-kpi-v ' + (d.profit_median > 0 ? 'green' : d.profit_median < 0 ? 'red' : '');
      s.getElementById('kvMargin').textContent = fmtPct(d.margin_pct);

      // Reset actions
      const invBtn = s.getElementById('fcInvBtn');
      invBtn.textContent = '+ Inventar'; invBtn.className = 'fc-action-btn'; invBtn.disabled = false;
      invBtn.onclick = () => this._addToInventory(d);
      this._alertOpen = false;
      s.getElementById('fcAlertForm').classList.remove('visible');
      s.getElementById('fcAlertInp').value = '';
      s.getElementById('fcAlertFeedback').style.display = 'none';
      this._updateCachedNote();
      this._enableDataTabs();
      this._setState('result');
    }

    _renderVelocityBar(sales) {
      const fill = this._shadow.getElementById('fcVelocityFill');
      if (sales == null || isNaN(sales)) { fill.style.width = '0%'; fill.style.background = '#EF4444'; return; }
      const n = Number(sales);
      if (n >= 50)      { fill.style.width = '100%'; fill.style.background = '#10B981'; }
      else if (n >= 10) { fill.style.width = '50%';  fill.style.background = '#F59E0B'; }
      else              { fill.style.width = '20%';  fill.style.background = '#EF4444'; }
    }

    // ── Inventory & Alerts ────────────────────────────────────────────────────
    _addToInventory(d) {
      const ek  = parseFloat(this._shadow.getElementById('fcEkInp').value) || 0;
      const btn = this._shadow.getElementById('fcInvBtn');
      btn.disabled = true; btn.textContent = '…';
      chrome.runtime.sendMessage({
        type: 'INVENTORY_ADD',
        item: { ean: this._identifier, title: d.title || '', ek, status: 'IN_STOCK', market: this._market, qty: 1 },
      }, res => {
        if (res?.ok) {
          btn.textContent = '✓ Gespeichert'; btn.className = 'fc-action-btn saved';
          setTimeout(() => { btn.textContent = '+ Inventar'; btn.className = 'fc-action-btn'; btn.disabled = false; }, 2500);
        } else {
          btn.textContent = 'Desktop inaktiv';
          setTimeout(() => { btn.textContent = '+ Inventar'; btn.disabled = false; }, 2000);
        }
      });
    }

    _checkInventoryStatus(identifier) {
      chrome.runtime.sendMessage({ type: 'INVENTORY_CHECK', ean: identifier }, res => {
        if (chrome.runtime.lastError || !res?.found) return;
        const btn = this._shadow.getElementById('fcInvBtn');
        const qty = res.item?.qty > 0 ? ` (${res.item.qty}x)` : '';
        btn.textContent = `✓ Im Inventar${qty}`; btn.className = 'fc-action-btn saved'; btn.onclick = null;
      });
    }

    _toggleAlertForm() {
      this._alertOpen = !this._alertOpen;
      this._shadow.getElementById('fcAlertForm').classList.toggle('visible', this._alertOpen);
      if (this._alertOpen) setTimeout(() => this._shadow.getElementById('fcAlertInp').focus(), 50);
    }

    _submitAlert() {
      const inp         = this._shadow.getElementById('fcAlertInp');
      const targetPrice = parseFloat(inp.value);
      if (!targetPrice || targetPrice <= 0) { inp.focus(); return; }
      const feedback = this._shadow.getElementById('fcAlertFeedback');
      const d        = this._result || {};
      chrome.runtime.sendMessage({
        type:  'ALERTS_CREATE',
        alert: { ean: this._identifier, title: d.title || this._identifier || '', target_price: targetPrice, market: this._market },
      }, res => {
        const ok = !res || res.ok !== false;
        feedback.textContent   = ok ? '✓ Alarm gesetzt' : '✗ Fehler';
        feedback.style.color   = ok ? '#10B981' : '#EF4444';
        feedback.style.display = 'block';
        setTimeout(() => {
          feedback.style.display = 'none'; inp.value = '';
          this._alertOpen = false;
          this._shadow.getElementById('fcAlertForm').classList.remove('visible');
        }, 2000);
      });
    }

    // ── Details Tab ───────────────────────────────────────────────────────────
    _populateDetails(d) {
      const s   = this._shadow;
      const fmt = v => v != null && !isNaN(v) ? `€${Number(v).toFixed(2)}` : '—';
      s.getElementById('detEmpty').style.display = 'none';

      if (this._market === 'ebay') {
        s.getElementById('detEbay').style.display   = '';
        s.getElementById('detAmazon').style.display = 'none';
        // API returns offer_count, days_to_cash, sales_30d — map to Details fields
        const listings = d.offer_count ?? d.listing_count ?? d.active_listings;
        s.getElementById('deListings').textContent  = listings != null ? String(listings) : '—';
        const sellers = d.seller_count ?? d.unique_sellers;
        s.getElementById('deSellers').textContent   = sellers != null ? String(sellers) : '—';
        s.getElementById('deAvgShip').textContent   = d.avg_shipping != null ? fmt(d.avg_shipping) : '—';
        const dtc = d.days_to_cash ?? d.avg_days_to_sell;
        s.getElementById('deDtc').textContent       = dtc != null ? `${dtc}T` : '—';
      } else {
        s.getElementById('detEbay').style.display   = 'none';
        s.getElementById('detAmazon').style.display = '';
        s.getElementById('daBoxPrice').textContent  = fmt(d.buy_box);
        s.getElementById('daBoxAvg30').textContent  = fmt(d.buy_box_avg30);
        const refPct = d.referral_pct != null ? `${Number(d.referral_pct).toFixed(0)}%` : '';
        s.getElementById('daRefFee').textContent    = refPct ? `${refPct} (${fmt(d.referral_fee)})` : fmt(d.referral_fee);
        s.getElementById('daFbaFee').textContent    = fmt(d.fba_fee);
        const prepFeeEl = s.getElementById('daPrepFee');
        if (prepFeeEl) prepFeeEl.textContent = d.prep_fee > 0 ? fmt(d.prep_fee) : '—';
        s.getElementById('daOffers').textContent    = d.fba_count != null
          ? `${d.fba_count} FBA / ${d.offer_count ?? '?'} ges.`
          : (d.offer_count ?? '—');
        s.getElementById('daRank').textContent      = d.sales_rank != null
          ? `#${Number(d.sales_rank).toLocaleString('de-DE')}` : '—';
        s.getElementById('daSales').textContent     = d.sales_30d != null ? `~${d.sales_30d}` : '—';
        // BSR drops: colour-code as buying signal
        const bsrDropEl = s.getElementById('daBsrDrops');
        if (d.bsr_drops_30d != null) {
          bsrDropEl.textContent = String(d.bsr_drops_30d);
          bsrDropEl.className   = 'fc-det-v ' + (d.bsr_drops_30d >= 10 ? 'green' : d.bsr_drops_30d >= 4 ? 'yellow' : '');
        } else {
          bsrDropEl.textContent = '—';
        }
        // Variants
        const varEl = s.getElementById('daVariants');
        if (d.variation_count != null && d.variation_count > 0) {
          varEl.textContent = `${d.variation_count} Varianten`;
        } else {
          varEl.textContent = d.variation_count === 0 ? 'Keine Varianten' : '—';
        }
      }
    }

    _recalcEbay() {
      if (!this._result || this._market !== 'ebay') return;
      const shipOut  = parseFloat(this._shadow.getElementById('deShipOut').value) || 0;
      const d        = this._result;
      const vk       = Number(d.sell_price_median) || 0;
      let fee        = d.fee ?? d.ebay_fee ?? null;
      if (fee == null) fee = typeof fcCalcEbayFee === 'function' ? fcCalcEbayFee(vk, 'sonstiges') : vk * 0.13;
      const profit   = vk - fee - this._lastEk - shipOut;
      const margin   = vk > 0 ? (profit / vk) * 100 : 0;
      const kvProfit = this._shadow.getElementById('kvProfit');
      kvProfit.textContent = `€${profit.toFixed(2)}`;
      kvProfit.className   = 'fc-kpi-v ' + (profit > 0 ? 'green' : profit < 0 ? 'red' : '');
      this._shadow.getElementById('kvMargin').textContent = `${margin.toFixed(1)}%`;
    }

    _recalcAmazon() {
      if (!this._result || this._market !== 'amazon') return;
      const shipIn   = parseFloat(this._shadow.getElementById('daShipIn').value) || 0;
      const d        = this._result;
      const vk       = Number(d.buy_box || d.sell_price_median) || 0;
      const ref      = Number(d.referral_fee) || 0;
      const fba      = this._amazonMethod === 'fba' ? (Number(d.fba_fee) || 0) : shipIn;
      const profit   = vk - ref - fba - this._lastEk;
      const margin   = vk > 0 ? (profit / vk) * 100 : 0;
      const kvProfit = this._shadow.getElementById('kvProfit');
      kvProfit.textContent = `€${profit.toFixed(2)}`;
      kvProfit.className   = 'fc-kpi-v ' + (profit > 0 ? 'green' : profit < 0 ? 'red' : '');
      this._shadow.getElementById('kvMargin').textContent = `${margin.toFixed(1)}%`;
    }

    // ── Chart ─────────────────────────────────────────────────────────────────
    _loadChartSeries(d) {
      const raw = d.price_series || d.amz_series || null;

      if (!raw || raw.length < 2) {
        // Try local price history
        chrome.runtime.sendMessage({ type: 'PRICE_HISTORY_GET', ean: this._identifier }, res => {
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

      // Normalize API series — supports {ts,price} objects or Keepa [minutes, cents] pairs
      this._chartSeries = raw.map(p => {
        if (Array.isArray(p)) {
          const t  = p[0];
          const pr = p[1];
          const ts = t < 1e9 ? (t + 21564000) * 60000 : (t > 1e12 ? t : t * 1000);
          return { ts, price: pr > 500 ? pr / 100 : pr };
        }
        return { ts: p.ts ?? p.timestamp ?? Date.now(), price: Number(p.price ?? p.vk ?? 0) };
      }).filter(p => isFinite(p.price) && p.price > 0 && p.price < 100000);
    }

    _drawChart() {
      const s       = this._shadow;
      const canvas  = s.getElementById('fcChartCanvas');
      const emptyEl = s.getElementById('fcChartEmpty');
      const statsEl = s.getElementById('fcChartStats');

      if (!this._chartSeries || this._chartSeries.length < 2) {
        canvas.style.display   = 'none';
        emptyEl.style.display  = '';
        statsEl.classList.remove('visible');
        return;
      }

      const now    = Date.now();
      const cutoff = now - this._chartDays * 86400000;
      const pts    = this._chartSeries.filter(p => p.ts >= cutoff);

      if (pts.length < 2) {
        canvas.style.display   = 'none';
        emptyEl.style.display  = '';
        statsEl.classList.remove('visible');
        return;
      }

      canvas.style.display   = 'block';
      emptyEl.style.display  = 'none';
      statsEl.classList.add('visible');

      const dpr  = window.devicePixelRatio || 1;
      // Use parent clientWidth — canvas.offsetWidth is 0 when pane was hidden
      const wrap = canvas.parentElement;
      const W    = (wrap ? wrap.clientWidth : 0) || 266;
      const H    = (wrap ? wrap.clientHeight : 0) || 100;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const prices = pts.map(p => p.price);
      const minP   = Math.min(...prices);
      const maxP   = Math.max(...prices);
      const range  = maxP - minP || 1;
      const PAD    = { t: 6, r: 6, b: 6, l: 6 };
      const cw     = W - PAD.l - PAD.r;
      const ch     = H - PAD.t - PAD.b;
      const toX    = i => PAD.l + (i / (pts.length - 1)) * cw;
      const toY    = p => PAD.t + ch - ((p - minP) / range) * ch;

      // Gradient fill
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
      grad.addColorStop(0, 'rgba(99,102,241,0.28)');
      grad.addColorStop(1, 'rgba(99,102,241,0.0)');
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(pts[0].price));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i].price));
      ctx.lineTo(toX(pts.length - 1), PAD.t + ch);
      ctx.lineTo(toX(0), PAD.t + ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.strokeStyle = '#6366F1';
      ctx.lineWidth   = 1.5;
      ctx.lineJoin    = 'round';
      ctx.moveTo(toX(0), toY(pts[0].price));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i].price));
      ctx.stroke();

      // Dot at last point
      const li = pts.length - 1;
      ctx.beginPath();
      ctx.arc(toX(li), toY(pts[li].price), 3, 0, Math.PI * 2);
      ctx.fillStyle = '#6366F1';
      ctx.fill();

      // Stats
      const sum = prices.reduce((a, b) => a + b, 0);
      const avg = sum / prices.length;
      const f   = v => `€${v.toFixed(2)}`;
      s.getElementById('csMin').textContent = f(minP);
      s.getElementById('csAvg').textContent = f(avg);
      s.getElementById('csMax').textContent = f(maxP);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    _updateCachedNote() {
      const el     = this._shadow.getElementById('fcCachedNote');
      if (!this._resultTs) { el.textContent = ''; return; }
      const ageMin = Math.floor((Date.now() - this._resultTs) / 60000);
      el.textContent = ageMin < 1 ? 'Live-Daten' : `Gecacht · vor ${ageMin}m`;
    }

    _setState(state) {
      const map = {
        idle: 'stIdle', loading: 'stLoading', result: 'stResult',
        error: 'stError', 'no-ean': 'stNoEan', 'plan-limit': 'stPlanLimit',
      };
      for (const [key, id] of Object.entries(map)) {
        const el = this._shadow.getElementById(id);
        if (el) el.classList.toggle('active', key === state);
      }
      if (state !== 'result') this._disableDataTabs();
      // Reset scan button whenever we leave no-ean state (probe was called)
      if (state !== 'no-ean') {
        const scanBtn = this._shadow.getElementById('fcScanBtn');
        if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '🔍 EAN scannen'; }
      }
    }

    _setupDrag(handle) {
      let startX, startY, origRight, origBottom;
      handle.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        startX = e.clientX; startY = e.clientY;
        origRight  = parseInt(this.style.right  || '20') || 20;
        origBottom = parseInt(this.style.bottom || '20') || 20;
        const onMove = ev => {
          const r = Math.max(0, origRight  - (ev.clientX - startX));
          const b = Math.max(0, origBottom - (ev.clientY - startY));
          this.style.right  = r + 'px';
          this.style.bottom = b + 'px';
          try { sessionStorage.setItem('fc_pos', JSON.stringify({ right: r, bottom: b })); } catch (_) {}
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
    }
  }

  // ── Manual init fallback ──────────────────────────────────────────────────
  // Used when customElements.define() is unavailable (e.g. Kaufland overrides it).
  // Replicates exactly what the FlipcheckPanel constructor does, applied to a plain element.
  function _manualInitPanel(el) {
    if (typeof el.probe === 'function') return; // already initialised (native or previous call)
    console.log('[FC] _manualInitPanel running on', el.tagName, el.id);

    // Bind all prototype methods & getters onto the element instance
    const proto = FlipcheckPanel.prototype;
    Object.getOwnPropertyNames(proto).forEach(name => {
      if (name === 'constructor') return;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc) return;
      if (typeof desc.value === 'function') {
        el[name] = desc.value.bind(el);
      } else if (desc.get || desc.set) {
        Object.defineProperty(el, name, {
          get: desc.get  ? desc.get.bind(el)  : undefined,
          set: desc.set  ? desc.set.bind(el)  : undefined,
          configurable: true, enumerable: false,
        });
      }
    });

    // Replicate FlipcheckPanel constructor body
    const shadow      = el.attachShadow({ mode: 'closed' });
    shadow.innerHTML  = PANEL_HTML;
    el._shadow        = shadow;
    el._market        = 'ebay';
    el._identifier    = null;
    el._mode          = 'mid';
    el._lastEk        = 0;
    el._result        = null;
    el._resultTs      = null;
    el._chartSeries   = null;
    el._chartDays     = 30;
    el._innerTab      = 'check';
    el._alertOpen     = false;
    el._amazonMethod  = 'fba';
    try {
      const pos = JSON.parse(sessionStorage.getItem('fc_pos') || '{}');
      if (pos.right  != null) el.style.right  = pos.right  + 'px';
      if (pos.bottom != null) el.style.bottom = pos.bottom + 'px';
    } catch (_) {}
    el._wireEvents();
    el._setupDrag(shadow.getElementById('fcHeader'));
    console.log('[FC] panel manually initialised — probe available:', typeof el.probe === 'function');
  }

  // ── Panel init helpers ────────────────────────────────────────────────────
  // Try to init any existing panel that hasn't been upgraded yet.
  function _tryInitExisting() {
    const el = document.getElementById('__fc_panel') ||
               document.querySelector('flipcheck-panel');
    if (el && typeof el.probe !== 'function') _manualInitPanel(el);
  }

  // MutationObserver: fires as soon as the panel element is appended to the DOM.
  // Gives customElements 100 ms to upgrade first; if still not upgraded, runs manual init.
  // Uses `document` as root so it works even at document_start before <html> is parsed.
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const target = (node.id === '__fc_panel' || node.tagName === 'FLIPCHECK-PANEL')
          ? node
          : node.querySelector?.('#__fc_panel, flipcheck-panel');
        if (target) {
          setTimeout(() => {
            if (typeof target.probe !== 'function') _manualInitPanel(target);
          }, 100); // 100 ms grace period for native custom-element upgrade
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  // Polling fallback: catches panels that were added before the observer started
  // (e.g. SPA redirects on MediaMarkt/Saturn where the panel creation races with script init).
  [200, 500, 1000, 2000, 4000].forEach(ms => setTimeout(_tryInitExisting, ms));

  // Also try customElements.define (works on sites that don't override it).
  // If it succeeds, Chrome auto-upgrades the element and _manualInitPanel skips (probe already there).
  (function _define(retries) {
    if (typeof customElements !== 'undefined' && customElements) {
      try {
        if (!customElements.get('flipcheck-panel')) {
          customElements.define('flipcheck-panel', FlipcheckPanel);
          console.log('[FC] flipcheck-panel defined via customElements OK');
        }
        return;
      } catch (_e) {
        console.warn('[FC] customElements.define failed:', _e.message);
      }
    } else {
      console.debug('[FC] customElements null/missing, retries left:', retries);
    }
    if (retries > 0) setTimeout(() => _define(retries - 1), 50);
  })(20);

  // ── Panel message hub (popup ↔ content script communication) ─────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const panel = document.getElementById('__fc_panel');

    // Return detected EAN + market to popup
    if (msg.type === 'GET_PANEL_EAN') {
      sendResponse({
        ean:    panel?.currentEan    || null,
        market: panel?.currentMarket || 'ebay',
      });
      return; // synchronous — no return true needed
    }

    // Trigger manual EAN re-scan (fires the same event as the 🔍 button)
    if (msg.type === 'TRIGGER_EAN_SCAN') {
      // Only dispatch if panel is fully upgraded — otherwise probe() doesn't exist yet
      if (panel && typeof panel.probe === 'function') {
        panel.dispatchEvent(new CustomEvent('fc-manual-ean', { bubbles: true, composed: true }));
      }
      sendResponse({ ok: true });
      return;
    }

    // Toggle panel visibility (Alt+F global command)
    if (msg.type === 'TOGGLE_PANEL') {
      if (panel) {
        panel.hasAttribute('data-minimized')
          ? panel.removeAttribute('data-minimized')
          : panel.setAttribute('data-minimized', '');
      }
      sendResponse({ ok: true });
      return;
    }
  });
})();
