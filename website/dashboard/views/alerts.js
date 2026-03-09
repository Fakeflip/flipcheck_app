/* Flipcheck Web App — Preisalarm View (v2 quality) */
const AlertsView = (() => {
  let _el     = null;
  let _alerts = [];
  let _showActive = true; // true = active, false = triggered/paused

  /* ── Shell ───────────────────────────────────────────────────────── */
  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Preisalarm</h1>
          <p>Benachrichtigung wenn eBay-Median-VK dein Ziel unterschreitet</p>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="al-stats-bar" id="alStats"></div>

      <div class="alerts-shell">
        <div class="alerts-left">
          <!-- Filter toggle -->
          <div class="seg" id="alFilterSeg" style="margin-bottom:12px">
            <button class="seg-btn active" data-show="active">Aktiv</button>
            <button class="seg-btn" data-show="triggered">Ausgelöst</button>
          </div>
          <div id="alertsList" class="alerts-list">
            <div class="al-loading">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/></svg>
              Lade Alarme…
            </div>
          </div>
        </div>

        <div class="alerts-right">
          <div class="al-panel-card">
            <div class="al-panel-head">
              <div class="al-panel-ico">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </div>
              <div>
                <div class="al-panel-title">Neuer Preisalarm</div>
                <div class="al-panel-sub">EAN + Zielpreis eingeben</div>
              </div>
            </div>

            <div class="la-field">
              <label class="input-label">EAN / GTIN</label>
              <input id="alEan" class="input" type="text" placeholder="z.B. 4010884506594" maxlength="20" inputmode="numeric"/>
            </div>

            <div class="la-field">
              <label class="input-label">Zielpreis <span style="font-weight:400;color:var(--dim)">(Alarm wenn ≤)</span></label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="alTarget" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            </div>

            <div class="la-field">
              <label class="input-label">Bezeichnung <span style="font-weight:400;color:var(--dim)">(optional)</span></label>
              <input id="alTitle" class="input" type="text" placeholder="z.B. Nintendo Switch Lite"/>
            </div>

            <button class="btn btn-primary al-add-btn" id="alAdd">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              Alarm setzen
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Stats bar ───────────────────────────────────────────────────── */
  function renderStats() {
    const statsEl = _el?.querySelector("#alStats");
    if (!statsEl) return;
    const total     = _alerts.length;
    const active    = _alerts.filter(a => !a.triggered_at).length;
    const triggered = _alerts.filter(a => !!a.triggered_at).length;
    statsEl.innerHTML = `
      <div class="al-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Gesamt</span>
        <span style="font-weight:700">${total}</span>
      </div>
      <div class="al-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Aktiv</span>
        <span style="font-weight:700;color:var(--accent)">${active}</span>
      </div>
      <div class="al-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Ausgelöst</span>
        <span style="font-weight:700;color:var(--green)">${triggered}</span>
      </div>
    `;
  }

  /* ── Alert row card ──────────────────────────────────────────────── */
  function renderAlertRow(alert) {
    const triggered = !!alert.triggered_at;
    const cardClass = triggered ? "al-alert-card al-alert-triggered" : "al-alert-card";

    // Progress bar: how close current to target (if we had current price)
    const target = alert.target_price;

    // Status chip
    let chipHtml = "";
    if (triggered) {
      chipHtml = `<span class="al-chip al-chip-triggered">✓ Ausgelöst ${fmtDate(alert.triggered_at)}</span>`;
    } else {
      chipHtml = `<span class="al-chip al-chip-active"><span class="al-chip-pulse"></span>Aktiv</span>`;
    }

    return `
      <div class="${cardClass}" data-alert-id="${esc(alert.id)}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="min-width:0;flex:1">
            <div class="al-alert-ean">${esc(alert.ean || "—")}</div>
            ${alert.title ? `<div class="al-alert-meta">${esc(alert.title)}</div>` : ""}
            <div style="margin-top:4px">${chipHtml}</div>
          </div>
          <!-- Price tiles -->
          <div class="al-price-row">
            <div class="al-price-tile">
              <div style="font-size:10px;color:var(--text-secondary);margin-bottom:2px">Ziel</div>
              <div style="font-weight:700;font-size:14px;color:${triggered ? "var(--green)" : "var(--text-primary)"}">
                ${target != null ? fmtEurPlain(target) : "—"}
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="al-alert-actions" style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end">
          ${triggered ? `<button class="btn btn-ghost btn-sm al-reset-btn" data-id="${esc(alert.id)}" title="Alarm zurücksetzen">↺ Reset</button>` : ""}
          <button class="btn btn-ghost btn-sm al-flipcheck-btn" data-id="${esc(alert.id)}" data-ean="${esc(alert.ean || "")}" title="Flipcheck" style="color:var(--accent)">▲ Check</button>
          <button class="btn btn-danger btn-sm al-del-btn" data-id="${esc(alert.id)}" title="Löschen">✕</button>
        </div>
      </div>
    `;
  }

  /* ── Render alert list ───────────────────────────────────────────── */
  function renderAlerts() {
    const listEl = _el?.querySelector("#alertsList");
    if (!listEl) return;

    renderStats();

    // Filter
    const filtered = _showActive
      ? _alerts.filter(a => !a.triggered_at)
      : _alerts.filter(a => !!a.triggered_at);

    if (!_alerts.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M18 4.5A11.25 11.25 0 0 1 29.25 15.75v4.5L31.5 24.75H4.5l2.25-4.5v-4.5A11.25 11.25 0 0 1 18 4.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.625 27.75a3.375 3.375 0 0 0 6.75 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p>Noch keine Alarme gesetzt</p>
        </div>`;
      return;
    }

    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M18 4.5A11.25 11.25 0 0 1 29.25 15.75v4.5L31.5 24.75H4.5l2.25-4.5v-4.5A11.25 11.25 0 0 1 18 4.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.625 27.75a3.375 3.375 0 0 0 6.75 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p>${_showActive ? "Keine aktiven Alarme" : "Keine ausgelösten Alarme"}</p>
        </div>`;
      return;
    }

    // Sort: triggered first within each view
    const sorted = [...filtered].sort((a, b) =>
      (b.triggered_at ? 1 : 0) - (a.triggered_at ? 1 : 0)
    );
    listEl.innerHTML = sorted.map(renderAlertRow).join("");

    // Bind delete
    listEl.querySelectorAll(".al-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ok = await Modal.confirm("Alarm löschen", "Diesen Alarm wirklich löschen?", { confirmLabel: "Löschen", danger: true });
        if (!ok) return;
        try {
          _alerts = await Storage.removeAlert(btn.dataset.id);
          renderAlerts();
          Toast.success("Alarm gelöscht");
        } catch (e) { Toast.error("Fehler", e.message); }
      });
    });

    // Bind reset
    listEl.querySelectorAll(".al-reset-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          _alerts = await Storage.resetAlert(btn.dataset.id);
          renderAlerts();
          Toast.info("Alarm zurückgesetzt");
        } catch (e) { Toast.error("Fehler", e.message); }
      });
    });

    // Bind flipcheck launch
    listEl.querySelectorAll(".al-flipcheck-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const ean = btn.dataset.ean;
        if (!ean) return;
        App._navPayload = { ean };
        App.navigateTo("flipcheck");
      });
    });
  }

  /* ── Bind events ─────────────────────────────────────────────────── */
  function bindEvents() {
    // Add alarm button
    _el?.querySelector("#alAdd")?.addEventListener("click", async () => {
      const ean    = _el.querySelector("#alEan").value.trim();
      const target = parseFloat(_el.querySelector("#alTarget").value) || 0;
      const title  = _el.querySelector("#alTitle").value.trim();

      if (!ean)    { Toast.error("EAN fehlt");       return; }
      if (!target) { Toast.error("Zielpreis fehlt"); return; }

      const btn = _el.querySelector("#alAdd");
      btn.disabled = true;
      try {
        _alerts = await Storage.addAlert({ ean, title, target_price: target, market: "ebay" });
        renderAlerts();
        _el.querySelector("#alEan").value    = "";
        _el.querySelector("#alTarget").value = "";
        _el.querySelector("#alTitle").value  = "";
        Toast.success("Alarm gesetzt", ean);
      } catch (e) { Toast.error("Fehler", e.message); }
      finally { btn.disabled = false; }
    });

    // Filter toggle
    _el?.querySelectorAll("#alFilterSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _showActive = btn.dataset.show === "active";
        _el.querySelectorAll("#alFilterSeg .seg-btn").forEach(b => {
          b.classList.toggle("active", b.dataset.show === (btn.dataset.show));
        });
        renderAlerts();
      });
    });
  }

  /* ── Mount / unmount ─────────────────────────────────────────────── */
  async function mount(el, navId) {
    _el = el;
    el.innerHTML = renderShell();
    _alerts = await Storage.listAlerts();
    if (App._navId !== navId) return;
    renderAlerts();
    bindEvents();
  }

  function unmount() { _el = null; }

  return { mount, unmount };
})();
