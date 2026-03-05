/* Flipcheck v2 — Preisalarm View */
const AlertsView = (() => {

  let _el        = null;
  let _alerts    = [];
  let _whUrl     = "";
  let _whEnabled = false;

  // ── Mount ──────────────────────────────────────────────────────────────────
  async function mount(el) {
    _el = el;
    const s    = await Storage.getSettings();
    _whUrl     = s?.webhook_url || "";
    _whEnabled = !!(s?.alert_webhook_enabled);
    _el.innerHTML = renderShell();
    await loadAlerts();
    bindEvents();
  }

  function unmount() { _el = null; }

  // ── Shell ──────────────────────────────────────────────────────────────────
  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Preisalarm</h1>
          <p>Automatische Benachrichtigung wenn der eBay-Preis dein Ziel unterschreitet</p>
          <div class="al-stats-bar" id="alStatsBar" style="display:none"></div>
        </div>
        <div class="page-header-right">
          <button class="btn btn-ghost btn-sm" id="alRefresh">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.86 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M13.5 2.5v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Jetzt prüfen
          </button>
        </div>
      </div>

      <div class="alerts-shell">

        <!-- Left: Alert-Karten -->
        <div class="alerts-left">
          <div id="alertsList" class="alerts-list">
            <div class="al-loading">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="al-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
              </svg>
              Lade Alarme…
            </div>
          </div>
        </div>

        <!-- Right: Neuer Alarm + Webhook + Info -->
        <div class="alerts-right">

          <!-- New Alert Form -->
          <div class="al-panel-card">
            <div class="al-panel-head">
              <div class="al-panel-ico">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </div>
              <div>
                <div class="al-panel-title">Neuer Preisalarm</div>
                <div class="al-panel-sub">EAN + Zielpreis eingeben</div>
              </div>
            </div>

            <div class="la-field">
              <label class="input-label">EAN / GTIN</label>
              <input id="alEan" class="input" type="text" placeholder="z.B. 4010884506594" maxlength="20"/>
            </div>

            <div class="la-field">
              <label class="input-label">
                Zielpreis
                <span style="font-weight:400;color:var(--dim)">(Alarm wenn ≤)</span>
              </label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="alTarget" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            </div>

            <div class="la-field">
              <label class="input-label">
                Bezeichnung
                <span style="font-weight:400;color:var(--dim)">(optional)</span>
              </label>
              <input id="alTitle" class="input" type="text" placeholder="z.B. Nintendo Switch Lite"/>
            </div>

            <button class="btn btn-primary al-add-btn" id="alAdd">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              Alarm hinzufügen
            </button>
          </div>

          <!-- Discord Webhook Card -->
          <div class="al-panel-card al-wh-panel">
            <div class="al-panel-head">
              <div class="al-panel-ico al-panel-ico--accent">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M6.5 1.5A5 5 0 0 1 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <circle cx="5" cy="11" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                  <circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                </svg>
              </div>
              <div>
                <div class="al-panel-title">Discord Webhook</div>
                <div class="al-panel-sub">Push-Benachrichtigung per Discord</div>
              </div>
            </div>

            <div class="al-wh-row">
              <label class="al-toggle" title="Discord-Alarm aktiv/inaktiv">
                <input type="checkbox" id="alWhEnabled" ${_whEnabled ? "checked" : ""}>
                <span class="al-toggle-track"></span>
                <span class="al-toggle-thumb"></span>
              </label>
              <span class="al-wh-label">Alarm per Discord senden</span>
            </div>

            ${_whUrl
              ? `<div class="al-wh-status-row">
                   <span class="al-wh-badge">
                     <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                       <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
                       <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                     </svg>
                     Webhook konfiguriert
                   </span>
                   <button class="btn btn-ghost btn-xs" id="alWhTest">Test senden</button>
                 </div>`
              : `<div class="al-wh-hint">
                   <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;opacity:.5;margin-top:1px">
                     <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
                     <path d="M8 5v4M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                   </svg>
                   <span>Kein Webhook konfiguriert —
                     <a href="#" id="alGoWebhook" class="al-wh-link">in Einstellungen einrichten →</a>
                   </span>
                 </div>`
            }
          </div>

          <!-- How it works -->
          <div class="al-panel-card">
            <div class="al-panel-head" style="margin-bottom:12px">
              <div class="al-panel-ico al-panel-ico--yellow">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M8 5v4M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </div>
              <div class="al-panel-title">So funktioniert's</div>
            </div>
            <div class="al-info-steps">
              <div class="al-info-step">
                <div class="al-info-num">1</div>
                <div class="al-info-text">EAN + Zielpreis eingeben und Alarm speichern</div>
              </div>
              <div class="al-info-step">
                <div class="al-info-num">2</div>
                <div class="al-info-text">Flipcheck prüft alle <strong>15 Minuten</strong> automatisch</div>
              </div>
              <div class="al-info-step">
                <div class="al-info-num">3</div>
                <div class="al-info-text">Preis ≤ Ziel → Desktop-Push + optionaler Discord-Webhook</div>
              </div>
              <div class="al-info-step">
                <div class="al-info-num">4</div>
                <div class="al-info-text">Alarm nach dem Kauf zurücksetzen oder löschen</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  // ── Load & render ──────────────────────────────────────────────────────────
  async function loadAlerts() {
    _alerts = await Storage.listAlerts();
    renderList();
    updateStatsBar();
  }

  function updateStatsBar() {
    const bar = _el?.querySelector("#alStatsBar");
    if (!bar) return;
    if (!_alerts.length) { bar.style.display = "none"; return; }
    const active    = _alerts.filter(a => a.active && !a.triggered).length;
    const triggered = _alerts.filter(a => a.triggered).length;
    const paused    = _alerts.filter(a => !a.active).length;
    const checks    = _alerts.reduce((s, a) => s + (a.check_count || 0), 0);
    bar.style.display = "flex";
    bar.innerHTML = `
      <span class="al-stat-pill"><b>${_alerts.length}</b> Alarme</span>
      <span class="al-stat-pill al-stat-pill-green"><b>${active}</b> Aktiv</span>
      ${triggered ? `<span class="al-stat-pill al-stat-pill-accent"><b>${triggered}</b> Ausgelöst</span>` : ""}
      ${paused    ? `<span class="al-stat-pill"><b>${paused}</b> Pausiert</span>` : ""}
      <span class="al-stat-pill"><b>${checks}</b> Prüfungen</span>
    `;
  }

  function renderList() {
    const container = _el?.querySelector("#alertsList");
    if (!container) return;

    if (!_alerts.length) {
      container.innerHTML = `
        <div class="al-empty">
          <div class="al-empty-ico">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <div class="al-empty-title">Noch kein Preisalarm</div>
          <div class="al-empty-sub">Füge rechts einen EAN + Zielpreis hinzu, um automatisch benachrichtigt zu werden.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = _alerts.map(a => renderAlertRow(a)).join("");
    // No per-row listener attachment — a single delegated listener on #alertsList
    // is attached once in bindEvents() and handles all dynamic card buttons.
  }

  function renderAlertRow(a) {
    const triggered = a.triggered;
    const active    = a.active;
    const cur       = a.last_price;
    const tgt       = a.target_price;
    // Explicit positivity check: tgt=0 would cause division by zero
    const diffPct   = (cur != null && tgt != null && tgt > 0) ? ((cur - tgt) / tgt * 100) : null;

    // Progress bar fill: target / current * 100 → 100% when cur == tgt
    const barPct   = (cur != null && cur > 0 && tgt != null && tgt > 0)
      ? Math.min(100, Math.max(0, (tgt / cur) * 100))
      : 0;
    const barColor = (triggered || (cur != null && cur <= tgt))
      ? "var(--green)"
      : diffPct != null && diffPct < 15
        ? "var(--yellow)"
        : "var(--accent)";

    // Status chip — SVG-based, no user data (all trusted HTML)
    let statusChip;
    if (triggered) {
      statusChip = `
        <span class="al-chip al-chip-triggered">
          <svg class="al-chip-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Ausgelöst
        </span>`;
    } else if (!active) {
      statusChip = `
        <span class="al-chip al-chip-paused">
          <svg class="al-chip-icon" viewBox="0 0 16 16" fill="none">
            <rect x="4" y="3.5" width="2.5" height="9" rx="1" fill="currentColor"/>
            <rect x="9.5" y="3.5" width="2.5" height="9" rx="1" fill="currentColor"/>
          </svg>
          Pausiert
        </span>`;
    } else {
      statusChip = `
        <span class="al-chip al-chip-active">
          <span class="al-chip-pulse"></span>
          Aktiv
        </span>`;
    }

    // Trusted SVG paths — no user data
    const toggleIcon = active
      ? `<rect x="4" y="3.5" width="2.5" height="9" rx="1" fill="currentColor"/><rect x="9.5" y="3.5" width="2.5" height="9" rx="1" fill="currentColor"/>`
      : `<path d="M5 3.5l10 4.5-10 4.5V3.5z" fill="currentColor"/>`;

    // Optional reset button — no user data
    const resetBtn = triggered
      ? `<button class="btn btn-ghost btn-xs al-row-reset" title="Zurücksetzen">
           <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
             <path d="M13 8A5 5 0 1 1 8 3c1.7 0 3.2.85 4.1 2.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
             <path d="M13 3v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
           </svg>
         </button>`
      : "";

    // Abstand-Kachel — computed numbers only
    const diffBlock = diffPct != null
      ? `<div class="al-price-tile">
           <span class="al-price-label">Abstand</span>
           <span class="al-price-val" style="color:${diffPct <= 0 ? "var(--green)" : diffPct < 15 ? "var(--yellow)" : "var(--text2)"}">
             ${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%
           </span>
         </div>`
      : "";

    // Triggered banner — formatted numbers/dates, no raw user strings
    const triggeredBanner = triggered && a.triggered_price
      ? `<div class="al-triggered-banner">
           <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;margin-top:1px">
             <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
             <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           </svg>
           <span>Zielpreis erreicht! Preis war <strong>${fmtEur(a.triggered_price)}</strong>${a.triggered_at ? ` am ${fmtDate(a.triggered_at)}` : ""}</span>
         </div>`
      : "";

    // History block — a.id is user-controlled, auto-escaped via html``
    const histBlock = a.trigger_history?.length
      ? html`<button class="al-history-btn" data-hist-id="${a.id}">
               <svg class="al-hist-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none">
                 <path d="M5 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
               </svg>
               Verlauf (${a.trigger_history.length})
             </button>
             <div class="al-history-panel" id="al-hist-${a.id}">
               ${html.safe([...a.trigger_history].reverse().map(h => `
                 <div class="al-history-row">
                   <span class="al-hist-ts">${fmtTime(h.ts)}</span>
                   <span class="al-hist-price">${fmtEur(h.price)}</span>
                   ${tgt ? `<span class="al-hist-delta">−${fmtEur(Math.max(0, tgt - h.price))} unter Ziel</span>` : ""}
                 </div>`).join(""))}
             </div>`
      : "";

    // html`` auto-escapes user values: a.id, a.title, a.ean
    // Trusted HTML chunks are wrapped in html.safe() to bypass escaping
    return html`
      <div class="al-alert-card${triggered ? " al-alert-triggered" : ""}${!active ? " al-alert-inactive" : ""}"
           data-alert-id="${a.id}">

        <!-- Header: name + chip + actions -->
        <div class="al-card-top">
          <div class="al-card-name-block">
            <div class="al-card-name">${(a.title || a.ean).slice(0, 52)}</div>
            <div class="al-card-ean">${a.ean}</div>
          </div>
          <div class="al-card-top-right">
            ${html.safe(statusChip)}
            <div class="al-card-actions">
              <button class="btn btn-ghost btn-xs al-row-toggle" title="${active ? "Pausieren" : "Aktivieren"}">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">${html.safe(toggleIcon)}</svg>
              </button>
              ${html.safe(resetBtn)}
              <button class="btn btn-ghost btn-xs al-row-del" title="Löschen">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M6 4V2h4v2M5 7v5M11 7v5M3 4l1 9h8l1-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Price comparison tiles -->
        <div class="al-price-row">
          <div class="al-price-tile">
            <span class="al-price-label">Zielpreis</span>
            <span class="al-price-val text-accent">${html.safe(fmtEur(tgt))}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="text-dim shrink-0">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="al-price-tile${(cur != null && tgt && cur <= tgt) ? " al-price-tile-hit" : ""}">
            <span class="al-price-label">Aktuell</span>
            <span class="al-price-val${(cur != null && tgt && cur <= tgt) ? " al-price-hit" : ""}">${html.safe(cur != null ? fmtEur(cur) : "—")}</span>
          </div>
          ${html.safe(diffBlock)}
        </div>

        <!-- Progress bar -->
        <div class="al-price-bar-wrap">
          <div class="al-price-bar-track">
            <div class="al-price-bar-fill" style="width:${barPct}%;background:${barColor}"></div>
          </div>
          <span class="al-price-bar-label">
            ${html.safe(a.last_checked ? fmtTime(a.last_checked) : "Noch nicht geprüft")}
          </span>
        </div>

        ${html.safe(triggeredBanner)}
        ${html.safe(histBlock)}

      </div>
    `;
  }

  /**
   * Attach a single delegated click handler on the #alertsList container.
   * Replaces N per-item listeners (re-attached on every renderList) with one
   * permanent listener that survives innerHTML replacement.
   * @param {HTMLElement} container - The #alertsList element
   */
  function bindRowEvents(container) {
    container.addEventListener("click", async e => {
      // ── History accordion toggle ─────────────────────────────────────────
      const histBtn = e.target.closest(".al-history-btn");
      if (histBtn) {
        const panel = document.getElementById(`al-hist-${histBtn.dataset.histId}`);
        if (!panel) return;
        const open = panel.classList.toggle("open");
        histBtn.classList.toggle("open", open);
        return;
      }

      // All remaining actions need a row id
      const id = e.target.closest("[data-alert-id]")?.dataset.alertId;
      if (!id) return;

      // ── Delete ───────────────────────────────────────────────────────────
      if (e.target.closest(".al-row-del")) {
        const ok = await Modal.confirm("Alarm löschen", "Diesen Preisalarm wirklich entfernen?", { confirmLabel: "Löschen", danger: true });
        if (ok) {
          try {
            _alerts = await Storage.removeAlert(id);
            renderList(); updateStatsBar();
          } catch (err) {
            Toast.error("Löschen fehlgeschlagen", "Alarm konnte nicht entfernt werden.");
            ErrorReporter.report(err, "alerts:removeAlert");
          }
        }
        return;
      }

      // ── Reset (re-arm) ───────────────────────────────────────────────────
      if (e.target.closest(".al-row-reset")) {
        try {
          _alerts = await Storage.resetAlert(id);
          renderList(); updateStatsBar();
          Toast.info("Zurückgesetzt", "Alarm ist wieder aktiv.");
        } catch (err) {
          Toast.error("Zurücksetzen fehlgeschlagen", "Alarm konnte nicht zurückgesetzt werden.");
          ErrorReporter.report(err, "alerts:resetAlert");
        }
        return;
      }

      // ── Toggle active/inactive ───────────────────────────────────────────
      if (e.target.closest(".al-row-toggle")) {
        const alert = _alerts.find(a => a.id === id);
        if (!alert) return;
        try {
          _alerts = await Storage.updateAlert({ id, active: !alert.active });
          renderList(); updateStatsBar();
        } catch (err) {
          Toast.error("Fehler", "Status konnte nicht geändert werden.");
          ErrorReporter.report(err, "alerts:toggleAlert");
        }
      }
    });
  }

  // ── Bind UI events ─────────────────────────────────────────────────────────
  function bindEvents() {
    // ── Row delegation: single listener on the stable list container ──────
    const listEl = _el?.querySelector("#alertsList");
    if (listEl) bindRowEvents(listEl);

    // Add alert
    _el?.querySelector("#alAdd")?.addEventListener("click", async () => {
      const ean    = _el.querySelector("#alEan")?.value.trim();
      const target = parseFloat(_el.querySelector("#alTarget")?.value);
      const title  = _el.querySelector("#alTitle")?.value.trim();

      if (!ean || !/^\d{8,14}$/.test(ean)) {
        Toast.error("Ungültige EAN", "Bitte eine gültige EAN/GTIN (8–14 Ziffern) eingeben.");
        return;
      }
      if (isNaN(target) || target <= 0) {
        Toast.error("Ungültiger Zielpreis", "Bitte einen gültigen Preis (> 0 €) eingeben.");
        return;
      }

      const btn = _el.querySelector("#alAdd");
      btn.disabled = true;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" class="al-spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
      </svg> Wird hinzugefügt…`;

      try {
        _alerts = await Storage.addAlert({ ean, target_price: target, title: title || null });
        renderList(); updateStatsBar();
        _el.querySelector("#alEan").value    = "";
        _el.querySelector("#alTarget").value = "";
        _el.querySelector("#alTitle").value  = "";
        Toast.success("Alarm gespeichert", `Preisalarm für EAN ${ean} (Ziel: ${fmtEur(target)}) ist jetzt aktiv.`);
      } catch (err) {
        Toast.error("Speichern fehlgeschlagen", "Alarm konnte nicht gespeichert werden.");
        ErrorReporter.report(err, "alerts:addAlert");
      }

      btn.disabled = false;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg> Alarm hinzufügen`;
    });

    // Jetzt prüfen
    _el?.querySelector("#alRefresh")?.addEventListener("click", async () => {
      const btn = _el.querySelector("#alRefresh");
      btn.disabled = true;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="al-spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
      </svg> Prüfe…`;
      await runAlertChecks();
      _alerts = await Storage.listAlerts();
      renderList(); updateStatsBar();
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.86 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M13.5 2.5v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Jetzt prüfen
      `;
    });

    // Webhook toggle
    _el?.querySelector("#alWhEnabled")?.addEventListener("change", async e => {
      _whEnabled = e.target.checked;
      await Storage.saveSettings({ alert_webhook_enabled: _whEnabled });
    });

    // Webhook test send
    _el?.querySelector("#alWhTest")?.addEventListener("click", async () => {
      if (!_whUrl) return;
      const btn = _el.querySelector("#alWhTest");
      btn.disabled = true; btn.textContent = "Sende…";
      try {
        await _fireAlertWebhook(_whUrl,
          { ean: "TEST-EAN", target_price: 29.99, title: "Testbenachrichtigung" }, 27.50);
        Toast.success("Test gesendet", "Discord-Webhook funktioniert korrekt.");
      } catch (err) {
        Toast.error("Webhook-Fehler", "Test konnte nicht gesendet werden. URL prüfen.");
        ErrorReporter.report(err, "alerts:testWebhook");
      }
      btn.disabled = false; btn.textContent = "Test senden";
    });

    // "konfigurieren →" → Settings
    _el?.querySelector("#alGoWebhook")?.addEventListener("click", e => {
      e.preventDefault();
      if (typeof navigateTo === "function") navigateTo("settings");
    });
  }

  // ── Intl singletons — created once per IIFE ────────────────────────────
  // Note: local esc() removed — renderAlertRow now uses html`` auto-escaping
  const _fmtEurAlerts  = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const _fmtDateAlerts = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const _fmtTimeAlerts = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

  function fmtEur(val) {
    if (val == null || isNaN(val)) return "—";
    return _fmtEurAlerts.format(val);
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    return _fmtDateAlerts.format(new Date(iso));
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    return _fmtTimeAlerts.format(new Date(iso));
  }

  return { mount, unmount };
})();

// ── Background Alert Checker ────────────────────────────────────────────────
// Called by app.js timer every 15 min and on "Jetzt prüfen"
async function runAlertChecks() {
  if (window._alertCheckRunning) return;
  window._alertCheckRunning = true;

  let alerts;
  try { alerts = await Storage.listAlerts(); }
  catch { window._alertCheckRunning = false; return; }

  const activeAlerts = alerts.filter(a => a.active && !a.triggered);
  if (!activeAlerts.length) { window._alertCheckRunning = false; return; }

  // Load webhook settings once
  let whUrl = ""; let whEnabled = false;
  try {
    const s = await Storage.getSettings();
    whUrl     = s?.webhook_url || "";
    whEnabled = !!(s?.alert_webhook_enabled);
  } catch {}

  const base = App?.backendBase || "http://127.0.0.1:9000";
  const fmt  = v => v != null ? `€${parseFloat(v).toFixed(2)}` : "—";
  let newlyTriggered = 0;

  try {
    for (const alert of activeAlerts) {
      try {
        const res = await fetch(`${base}/flipcheck`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ean: alert.ean, ek: 0, mode: "mid" }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const currentPrice = data.sell_price_median ?? data.sell_price_avg ?? data.browse_price ?? null;

        const patch = { id: alert.id, last_checked: new Date().toISOString(), last_price: currentPrice };

        if (currentPrice != null && currentPrice <= alert.target_price) {
          patch.triggered       = true;
          patch.triggered_at    = new Date().toISOString();
          patch.triggered_price = currentPrice;
          newlyTriggered++;

          // Desktop notification
          const notifBody = `${alert.title || alert.ean}: eBay ${fmt(currentPrice)} ≤ Ziel ${fmt(alert.target_price)}`;
          try { await window.fc.notify("🎯 Preisalarm ausgelöst!", notifBody); } catch {}
          Toast.success("Preisalarm!", `${alert.title || alert.ean}: ${fmt(currentPrice)}`);

          // Discord webhook
          if (whUrl && whEnabled) {
            _fireAlertWebhook(whUrl, alert, currentPrice).catch(() => {});
          }
        }

        await Storage.updateAlert(patch);
      } catch { /* skip failed checks silently */ }
    }
  } finally {
    window._alertCheckRunning = false;
  }

  if (newlyTriggered > 0) {
    if (App?.currentView === "alerts" && AlertsView && document.querySelector("#view-root > div")) {
      AlertsView.mount(document.querySelector("#view-root > div"));
    }
  }
}

// Fire a Discord embed for a triggered price alert
async function _fireAlertWebhook(webhookUrl, alert, currentPrice) {
  const fmt = v => v != null ? `€${parseFloat(v).toFixed(2)}` : "—";
  const savings = (alert.target_price - currentPrice);
  const payload = JSON.stringify({
    username: "Flipcheck",
    embeds: [{
      color:       0x10B981,
      author:      { name: "▲ FLIPCHECK" },
      title:       "🎯 Preisalarm ausgelöst!",
      description: `**${alert.title || alert.ean}**`,
      fields: [
        { name: "EAN",        value: String(alert.ean),               inline: true },
        { name: "Zielpreis",  value: fmt(alert.target_price),         inline: true },
        { name: "eBay-Preis", value: fmt(currentPrice),               inline: true },
        { name: "Ersparnis",  value: savings > 0 ? `−${fmt(savings)}` : "—", inline: true },
      ],
      footer:    { text: `Flipcheck · ${new Date().toLocaleString("de-DE")}` },
      timestamp: new Date().toISOString(),
    }],
  });
  const r = await fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    payload,
  });
  if (!r.ok && r.status !== 204) throw new Error(`Discord HTTP ${r.status}`);
}
