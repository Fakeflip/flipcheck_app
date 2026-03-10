/* Flipcheck v2 — Settings View (SaaS) */
const SettingsView = (() => {
  let _container = null;
  let _saveTimer = null;

  async function mount(container) {
    _container = container;
    const settings = await Storage.getSettings().catch(() => ({}));
    container.innerHTML = renderView(settings);
    attachEvents(container, settings);
    loadProfile(container);
  }

  function unmount() { _container = null; }

  // ─── Auto-save ─────────────────────────────────────────────────────────────
  function scheduleSave(container) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => doSave(container), 600);
  }

  async function doSave(container) {
    const patch = collectSettings(container);
    await Storage.saveSettings(patch);
    const indicator = container.querySelector("#saveIndicator");
    if (indicator) {
      indicator.textContent = I18N.t('st.saved');
      indicator.style.opacity = "1";
      clearTimeout(indicator._t);
      indicator._t = setTimeout(() => { indicator.style.opacity = "0"; }, 2000);
    }
  }

  function collectSettings(container) {
    return {
      analytics: {
        weekly_profit_target: parseFloat(container.querySelector("#sWeeklyTarget")?.value) || 0,
      },
      tax: {
        vat_mode: container.querySelector("#sVatMode")?.value || "no_vat",
        ek_mode:  container.querySelector("#sEkModeSeg .seg-btn.active")?.dataset.val || "gross",
      },
      defaults: {
        market:         container.querySelector("#sDefaultMarket")?.value || "ebay",
        flipcheck_mode: container.querySelector("#sModeSeg .seg-btn.active")?.dataset.val || "mid",
        ek_mode:        container.querySelector("#sEkModeSeg .seg-btn.active")?.dataset.val || "gross",
      },
      flipcheck_fields: {
        ship_in:   !!container.querySelector("#sFcShipIn")?.checked,
        ship_out:  !!container.querySelector("#sFcShipOut")?.checked,
        packaging: !!container.querySelector("#sFcPackaging")?.checked,
        ad_rate:   !!container.querySelector("#sFcAdRate")?.checked,
      },
    };
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function renderView(s) {
    const profit        = s?.analytics?.weekly_profit_target || "";
    const vat           = s?.tax?.vat_mode || "no_vat";
    const defaultMarket = s?.defaults?.market || "ebay";
    const defaultMode   = s?.defaults?.flipcheck_mode || "mid";
    const ekMode        = s?.defaults?.ek_mode || "gross";
    const ff            = s?.flipcheck_fields || {};
    const fcShipIn      = ff.ship_in   !== false;
    const fcShipOut     = ff.ship_out  !== false;
    const fcPackaging   = ff.packaging === true;
    const fcAdRate      = ff.ad_rate   === true;

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>${I18N.t('st.title')}</h1>
          <p>${I18N.t('st.subtitle')}</p>
        </div>
        <div class="page-header-actions">
          <span id="saveIndicator" class="st-save-indicator">${I18N.t('st.saved')}</span>
        </div>
      </div>

      <div class="st-wrapper">

        <!-- ── Konto ──────────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.account'), icoUser(), I18N.t('st.section.account.desc'))}
          <div class="panel st-panel" id="profileSection">
            <div class="settings-row" style="border:none;gap:14px;padding:2px 0">
              <div class="skeleton" style="width:52px;height:52px;border-radius:50%;flex-shrink:0"></div>
              <div style="display:flex;flex-direction:column;gap:7px;flex:1">
                <div class="skeleton" style="width:150px;height:14px"></div>
                <div class="skeleton" style="width:110px;height:11px"></div>
              </div>
              <div class="skeleton" style="width:56px;height:22px;border-radius:20px"></div>
            </div>
          </div>
        </div>

        <!-- ── Sprache ────────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.lang'), icoGlobe(), I18N.t('st.section.lang.desc'))}
          <div class="panel st-panel">
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.section.lang')}</h4>
                <p>${I18N.t('st.section.lang.desc')}</p>
              </div>
              <div id="stLangSelector">
                ${I18N.renderSelector(I18N.getLang())}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Berechnungen ───────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.calc'), icoCalc(), I18N.t('st.section.calc.desc'))}
          <div class="panel st-panel">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.vat.title')}</h4>
                <p>${I18N.t('st.vat.desc')}</p>
              </div>
              <select id="sVatMode" class="select" style="width:200px">
                <option value="no_vat" ${vat === "no_vat" ? "selected" : ""}>${I18N.t('st.vat.small')}</option>
                <option value="ust_19" ${vat === "ust_19" ? "selected" : ""}>${I18N.t('st.vat.regular')}</option>
              </select>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.ek.title')}</h4>
                <p>${I18N.t('st.ek.desc')}</p>
              </div>
              <div class="seg" id="sEkModeSeg">
                <button class="seg-btn ${ekMode === "gross" ? "active" : ""}" data-val="gross">${I18N.t('st.ek.gross')}</button>
                <button class="seg-btn ${ekMode === "net"   ? "active" : ""}" data-val="net">${I18N.t('st.ek.net')}</button>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.market.title')}</h4>
                <p>${I18N.t('st.market.desc')}</p>
              </div>
              <select id="sDefaultMarket" class="select" style="width:160px">
                <option value="ebay"     ${defaultMarket === "ebay"     ? "selected" : ""}>eBay</option>
                <option value="amazon"   ${defaultMarket === "amazon"   ? "selected" : ""}>Amazon</option>
                <option value="kaufland" ${defaultMarket === "kaufland" ? "selected" : ""}>Kaufland</option>
              </select>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.mode.title')}</h4>
                <p>${I18N.t('st.mode.desc')}</p>
              </div>
              <div class="seg" id="sModeSeg">
                <button class="seg-btn ${defaultMode === "low"  ? "active" : ""}" data-val="low">LOW</button>
                <button class="seg-btn ${defaultMode === "mid"  ? "active" : ""}" data-val="mid">MID</button>
                <button class="seg-btn ${defaultMode === "high" ? "active" : ""}" data-val="high">HIGH</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Flipcheck Felder ─────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.fc_fields'), icoForm(), I18N.t('st.section.fc_fields.desc'))}
          <div class="panel st-panel">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.fc_field.ship_in')}</h4>
              </div>
              <label class="toggle"><input type="checkbox" id="sFcShipIn" ${fcShipIn ? "checked" : ""} /><span class="toggle-slider"></span></label>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.fc_field.ship_out')}</h4>
              </div>
              <label class="toggle"><input type="checkbox" id="sFcShipOut" ${fcShipOut ? "checked" : ""} /><span class="toggle-slider"></span></label>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.fc_field.packaging')}</h4>
              </div>
              <label class="toggle"><input type="checkbox" id="sFcPackaging" ${fcPackaging ? "checked" : ""} /><span class="toggle-slider"></span></label>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.fc_field.ad_rate')}</h4>
              </div>
              <label class="toggle"><input type="checkbox" id="sFcAdRate" ${fcAdRate ? "checked" : ""} /><span class="toggle-slider"></span></label>
            </div>
          </div>
        </div>

        <!-- ── Analytics ──────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.analytics'), icoChart(), I18N.t('st.section.analytics.desc'))}
          <div class="panel st-panel">
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.profit.title')}</h4>
                <p>${I18N.t('st.profit.desc')}</p>
              </div>
              <div class="input-prefix-wrap" style="width:120px">
                <span class="prefix">€</span>
                <input id="sWeeklyTarget" class="input" type="number" min="0" step="10"
                  value="${esc(String(profit))}"
                  style="text-align:right;padding-right:12px;padding-left:26px" />
              </div>
            </div>
          </div>
        </div>

        <!-- ── Shortcuts ──────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.shortcuts'), icoKeyboard(), I18N.t('st.section.shortcuts.desc'))}
          <div class="panel st-panel">
            ${renderShortcuts()}
          </div>
        </div>

        <!-- ── App & Updates ──────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.app'), icoApp(), I18N.t('st.section.app.desc'))}
          <div class="panel st-panel">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.version.title')}</h4>
                <p id="settingsVersion" style="font-family:var(--font-mono,monospace);font-size:11px;margin-top:2px">Lade…</p>
              </div>
              <div id="updaterStatus" style="font-size:11px;color:var(--text-muted);text-align:right"></div>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.update.title')}</h4>
                <p>${I18N.t('st.update.desc')}</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-secondary btn-sm" id="btnCheckUpdates">${I18N.t('st.update.check')}</button>
                <button class="btn btn-primary btn-sm" id="btnInstallUpdate" style="display:none">${I18N.t('st.update.install')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Gefahrenzone ───────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader(I18N.t('st.section.danger'), icoDanger(), I18N.t('st.section.danger.desc'), true)}
          <div class="panel st-panel" style="border-color:var(--red-border)">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.danger.history.title')}</h4>
                <p>${I18N.t('st.danger.history.desc')}</p>
              </div>
              <button class="btn btn-sm" id="btnVacuumHistory" style="border-color:var(--red-border);color:var(--red)">${I18N.t('st.danger.history.btn')}</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>${I18N.t('st.danger.inventory.title')}</h4>
                <p>${I18N.t('st.danger.inventory.desc')}</p>
              </div>
              <button class="btn btn-danger btn-sm" id="btnClearInventory">${I18N.t('st.danger.inventory.btn')}</button>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>${I18N.t('st.danger.logout.title')}</h4>
                <p>${I18N.t('st.danger.logout.desc')}</p>
              </div>
              <button class="btn btn-danger btn-sm" id="btnSettingsLogout">${I18N.t('st.danger.logout.btn')}</button>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // ─── Section header helper ──────────────────────────────────────────────────
  function sectionHeader(title, icon, desc, danger = false) {
    return `
      <div class="st-section-head">
        <div class="st-section-ico ${danger ? "st-section-ico--danger" : ""}">${icon}</div>
        <div>
          <div class="st-section-title ${danger ? "st-section-title--danger" : ""}">${title}</div>
          <div class="st-section-desc">${desc}</div>
        </div>
      </div>
    `;
  }

  // ─── Shortcuts table ────────────────────────────────────────────────────────
  function renderShortcuts() {
    const rows = [
      { keys: ["Enter"],    desc: I18N.t('st.sc.enter') },
      { keys: ["Escape"],   desc: I18N.t('st.sc.escape') },
      { keys: ["↑", "↓"],  desc: I18N.t('st.sc.arrows') },
      { keys: ["Alt", "F"], desc: I18N.t('st.sc.panel') },
    ];
    return rows.map((r, i) => `
      <div class="settings-row${i === rows.length - 1 ? ' style="border:none"' : ''}">
        <div class="settings-row-left">
          <h4 style="font-weight:500">${r.desc}</h4>
        </div>
        <div class="st-kbd-group">
          ${r.keys.map(k => `<kbd class="st-kbd">${k}</kbd>`).join('<span class="st-kbd-sep">+</span>')}
        </div>
      </div>
    `).join("");
  }

  // ─── Icons ─────────────────────────────────────────────────────────────────
  function icoUser() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoGlobe() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 2c-2 2-2 8 0 12M8 2c2 2 2 8 0 12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoCalc() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5 5.5h6M5 8.5h3.5M5 11.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoChart() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2 11.5L5.5 7.5 8.5 10 12 5l2.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function icoKeyboard() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="4.5" width="14" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M4 7h1M7 7h1M10 7h1M4 9.5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoApp() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 5v6M5.5 8h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoDanger() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L14.5 13.5H1.5L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M8 6.5V9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="8" cy="11.5" r=".6" fill="currentColor"/>
    </svg>`;
  }
  function icoForm() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5 6h6M5 8.5h4M5 11h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function attachEvents(container, settings) {

    // Language selector
    container.querySelectorAll("#stLangSelector .lang-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        I18N.setLang(btn.dataset.lang); // saves to storage + updates DOM
        // Re-render settings with new language
        container.innerHTML = renderView(settings);
        attachEvents(container, settings);
        loadProfile(container);
      });
    });

    // Seg buttons → auto-save
    ["#sEkModeSeg", "#sModeSeg"].forEach(id => {
      container.querySelectorAll(`${id} .seg-btn`).forEach(btn => {
        btn.addEventListener("click", () => {
          container.querySelectorAll(`${id} .seg-btn`).forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          scheduleSave(container);
        });
      });
    });

    // Select / input → auto-save
    ["#sVatMode", "#sDefaultMarket"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container));
    });
    container.querySelector("#sWeeklyTarget")?.addEventListener("input", () => scheduleSave(container));

    // Flipcheck field toggles → auto-save
    ["#sFcShipIn", "#sFcShipOut", "#sFcPackaging", "#sFcAdRate"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container));
    });

    // Price history vacuum
    container.querySelector("#btnVacuumHistory")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(
        I18N.t('st.danger.history.title'),
        "EANs ohne Eintrag in den letzten 90 Tagen werden dauerhaft entfernt. Fortfahren?",
        { confirmLabel: I18N.t('st.danger.history.btn'), danger: false }
      );
      if (!ok) return;
      try {
        const btn = container.querySelector("#btnVacuumHistory");
        if (btn) btn.textContent = "…";
        const { removed } = await window.fc.priceHistoryVacuum();
        Toast.success("Bereinigt", removed > 0 ? `${removed} EAN${removed !== 1 ? "s" : ""} entfernt.` : "Keine veralteten Einträge gefunden.");
      } catch (err) {
        ErrorReporter.report(err, "settings:vacuumHistory");
        Toast.error("Fehler", "Bereinigung fehlgeschlagen.");
      } finally {
        const btn = container.querySelector("#btnVacuumHistory");
        if (btn) btn.textContent = I18N.t('st.danger.history.btn');
      }
    });

    // Danger: clear inventory
    container.querySelector("#btnClearInventory")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(
        I18N.t('st.danger.inventory.title'),
        "Wirklich alle Artikel aus dem Inventory löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
        { confirmLabel: I18N.t('st.danger.inventory.btn'), danger: true }
      );
      if (!ok) return;
      try {
        await window.fc.inventoryClear();
        Toast.success("Gelöscht", "Inventory wurde zurückgesetzt.");
      } catch (err) {
        ErrorReporter.report(err, "settings:clearInventory");
        Toast.error("Inventory-Fehler", "Inventory konnte nicht gelöscht werden. Bitte erneut versuchen.");
      }
    });

    // Danger: logout
    container.querySelector("#btnSettingsLogout")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(I18N.t('st.danger.logout.title'), "Wirklich ausloggen? Das Gerät wird aus der Lizenz entknüpft.", { confirmLabel: I18N.t('st.danger.logout.btn'), danger: true });
      if (!ok) return;
      try { await window.fc.logout(); } catch {}
      window.location.reload();
    });

    // Version
    window.fc?.version?.().then(v => {
      const el = container.querySelector("#settingsVersion");
      if (el) el.textContent = `Flipcheck v${v || "2.0.0"}`;
    }).catch(() => {});

    // Updater
    container.querySelector("#btnCheckUpdates")?.addEventListener("click", async () => {
      const btn      = container.querySelector("#btnCheckUpdates");
      const statusEl = container.querySelector("#updaterStatus");
      btn.disabled = true; btn.textContent = I18N.t('st.update.checking');
      try { await window.fc?.checkForUpdates?.(); } catch {}
      setTimeout(() => {
        btn.disabled = false; btn.textContent = I18N.t('st.update.check');
        if (statusEl && !statusEl.dataset.hasUpdate) {
          statusEl.innerHTML = `<span class="text-green">${I18N.t('st.update.ok')}</span>`;
          setTimeout(() => { if (statusEl && !statusEl.dataset.hasUpdate) statusEl.textContent = ""; }, 3000);
        }
      }, 3500);
    });

    container.querySelector("#btnInstallUpdate")?.addEventListener("click", () => {
      window.fc?.installUpdate?.();
    });

    window.fc?.onUpdateAvailable?.((info) => {
      const statusEl = container.querySelector("#updaterStatus");
      if (!statusEl) return;
      statusEl.dataset.hasUpdate = "1";
      statusEl.innerHTML = `<span style="color:var(--accent)">v${info?.version || "?"} wird geladen…</span>`;
    });

    window.fc?.onUpdateDownloaded?.((info) => {
      const statusEl = container.querySelector("#updaterStatus");
      if (statusEl) {
        statusEl.dataset.hasUpdate = "1";
        statusEl.innerHTML = `<span style="color:var(--green)">v${info?.version || "?"} bereit</span>`;
      }
      const installBtn = container.querySelector("#btnInstallUpdate");
      if (installBtn) installBtn.style.display = "";
    });
  }

  // ─── Profile card ──────────────────────────────────────────────────────────
  function _jwtClaims(token) {
    try { return JSON.parse(atob((token || "").split(".")[1])); } catch { return {}; }
  }

  async function loadProfile(container) {
    const profileSection = container.querySelector("#profileSection");
    if (!profileSection) return;

    const claims = _jwtClaims(App.token);

    try {
      const r = await API.call("/auth/me");
      if (!r.ok || !r.data) throw new Error("not_ok");
      const u = r.data;

      const plan = (u.plan || "FREE").toUpperCase();
      const planMeta = {
        FREE:     { bg: "rgba(71,85,105,.14)",  color: "#94A3B8", border: "rgba(71,85,105,.3)" },
        PRO:      { bg: "rgba(99,102,241,.14)", color: "#818CF8", border: "rgba(99,102,241,.35)" },
        LIFETIME: { bg: "rgba(245,158,11,.14)", color: "#FBBF24", border: "rgba(245,158,11,.35)" },
      };
      const pm       = planMeta[plan] || planMeta.FREE;
      const initials = (u.username || u.email || "?").slice(0, 2).toUpperCase();
      const since    = u.created_at
        ? new Date(u.created_at).toLocaleDateString("de-DE", { month: "long", year: "numeric" })
        : null;

      const proFeatures = [
        "Unbegrenzte Checks",
        "Batch-Analyse & CSV",
        "Analytics-Dashboard",
        "Preisalerts & Webhooks",
        "Multi-Device Sync (2 Geräte)",
      ];

      const avatarHtml = u.avatar_url
        ? `<img src="${esc(u.avatar_url)}" class="profile-avatar" alt="" onerror="this.style.display='none'" />`
        : `<div class="profile-avatar profile-avatar-fallback">${initials}</div>`;

      profileSection.innerHTML = `
        <div class="st-profile-top">
          <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0">
            ${avatarHtml}
            <div style="min-width:0">
              <div class="st-profile-name">${esc(u.username || u.email || "—")}</div>
              ${u.email && u.email !== u.username
                ? `<div class="text-xs" style="color:var(--text-muted);margin-top:2px">${esc(u.email)}</div>`
                : ""}
              ${since
                ? `<div class="text-xs" style="color:var(--text-muted);margin-top:3px">${I18N.t('st.profile.member_since')} ${since}</div>`
                : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0">
            <span class="profile-plan-badge"
              style="background:${pm.bg};color:${pm.color};border-color:${pm.border}">
              ${plan}
            </span>
            ${!u.license_ok
              ? `<button class="btn btn-primary btn-sm" style="font-size:11px" id="btnSettingsUpgrade">${I18N.t('st.profile.upgrade')}</button>`
              : ""}
          </div>
        </div>
        <div class="st-plan-grid">
          ${u.license_ok
            ? proFeatures.map(f => `
                <div class="st-plan-feat st-plan-feat--active">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="var(--green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  ${f}
                </div>`).join("")
            : proFeatures.map(f => `
                <div class="st-plan-feat st-plan-feat--locked">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="var(--text-muted)" stroke-width="1.4" stroke-linecap="round"/>
                  </svg>
                  ${f}
                </div>`).join("")
          }
        </div>
      `;
      const upgBtn = profileSection.querySelector("#btnSettingsUpgrade");
      if (upgBtn) {
        upgBtn.addEventListener("click", async () => {
          upgBtn.disabled = true;
          upgBtn.textContent = "Lade…";
          try {
            const { ok, data } = await API.createCheckoutSession();
            if (ok && data?.checkout_url) window.open(data.checkout_url, "_blank");
            else Toast.error("Fehler", "Checkout konnte nicht geöffnet werden.");
          } catch { Toast.error("Fehler", "Verbindung fehlgeschlagen."); }
          finally { upgBtn.disabled = false; upgBtn.textContent = I18N.t('st.profile.upgrade'); }
        });
      }
    } catch {
      const name = claims.discord_username || claims.sub || "";
      if (!name) {
        profileSection.innerHTML = `
          <div class="settings-row" style="border:none">
            <div class="settings-row-left">
              <h4>${I18N.t('st.profile.not_logged.title')}</h4>
              <p>${I18N.t('st.profile.not_logged.sub')}</p>
            </div>
            <button class="btn btn-primary btn-sm" onclick="window.location.reload()">${I18N.t('st.profile.not_logged.btn')}</button>
          </div>
        `;
        return;
      }
      const initials = name.slice(0, 2).toUpperCase();
      profileSection.innerHTML = `
        <div class="st-profile-top">
          <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0">
            <div class="profile-avatar profile-avatar-fallback">${initials}</div>
            <div style="min-width:0">
              <div class="st-profile-name">${esc(name)}</div>
              <div class="text-xs" style="color:var(--text-muted);margin-top:2px">Discord Account</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  return { mount, unmount };
})();
