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
    };
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function renderView(s) {
    const profit        = s?.analytics?.weekly_profit_target || "";
    const vat           = s?.tax?.vat_mode || "no_vat";
    const defaultMarket = s?.defaults?.market || "ebay";
    const defaultMode   = s?.defaults?.flipcheck_mode || "mid";
    const ekMode        = s?.defaults?.ek_mode || "gross";

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Einstellungen</h1>
          <p>Konto, Präferenzen und App-Konfiguration</p>
        </div>
        <div class="page-header-actions">
          <span id="saveIndicator" class="st-save-indicator">Gespeichert ✓</span>
        </div>
      </div>

      <div class="st-wrapper">

        <!-- ── Konto ──────────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader("Konto", icoUser(), "Profil und Lizenzstatus")}
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

        <!-- ── Berechnungen ───────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader("Berechnungen", icoCalc(), "MwSt-Modus, EK-Eingabe und Standard-Werte")}
          <div class="panel st-panel">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>MwSt-Modus</h4>
                <p>Wie Verkaufspreise im Profit-Rechner behandelt werden</p>
              </div>
              <select id="sVatMode" class="select" style="width:200px">
                <option value="no_vat" ${vat === "no_vat" ? "selected" : ""}>Kleinunternehmer (§19, 0 %)</option>
                <option value="ust_19" ${vat === "ust_19" ? "selected" : ""}>Regelbesteuerung (19 %)</option>
              </select>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>EK-Eingabe</h4>
                <p>Einkaufspreis als Brutto (inkl. MwSt) oder Netto eingeben</p>
              </div>
              <div class="seg" id="sEkModeSeg">
                <button class="seg-btn ${ekMode === "gross" ? "active" : ""}" data-val="gross">Brutto</button>
                <button class="seg-btn ${ekMode === "net"   ? "active" : ""}" data-val="net">Netto</button>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>Standard-Marktplatz</h4>
                <p>Vorausgewählter Markt beim Öffnen des Flipchecks</p>
              </div>
              <select id="sDefaultMarket" class="select" style="width:160px">
                <option value="ebay"     ${defaultMarket === "ebay"     ? "selected" : ""}>eBay</option>
                <option value="amazon"   ${defaultMarket === "amazon"   ? "selected" : ""}>Amazon</option>
                <option value="kaufland" ${defaultMarket === "kaufland" ? "selected" : ""}>Kaufland</option>
              </select>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>Analyse-Modus</h4>
                <p>LOW = konservativ &nbsp;·&nbsp; MID = realistisch &nbsp;·&nbsp; HIGH = optimistisch</p>
              </div>
              <div class="seg" id="sModeSeg">
                <button class="seg-btn ${defaultMode === "low"  ? "active" : ""}" data-val="low">LOW</button>
                <button class="seg-btn ${defaultMode === "mid"  ? "active" : ""}" data-val="mid">MID</button>
                <button class="seg-btn ${defaultMode === "high" ? "active" : ""}" data-val="high">HIGH</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Analytics ──────────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader("Analytics", icoChart(), "Ziele und Dashboard-Tracking")}
          <div class="panel st-panel">
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>Wöchentliches Profit-Ziel</h4>
                <p>Wird als Ziel-Linie im Analytics-Dashboard angezeigt</p>
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
          ${sectionHeader("Tastenkürzel", icoKeyboard(), "Schnellnavigation und Eingabe-Shortcuts")}
          <div class="panel st-panel">
            ${renderShortcuts()}
          </div>
        </div>

        <!-- ── App & Updates ──────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader("App & Updates", icoApp(), "Version und automatische Updates")}
          <div class="panel st-panel">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>Version</h4>
                <p id="settingsVersion" style="font-family:var(--font-mono,monospace);font-size:11px;margin-top:2px">Lade…</p>
              </div>
              <div id="updaterStatus" style="font-size:11px;color:var(--text-muted);text-align:right"></div>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>Nach Updates suchen</h4>
                <p>Automatischer Download bei neuem Release</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-secondary btn-sm" id="btnCheckUpdates">Prüfen</button>
                <button class="btn btn-primary btn-sm" id="btnInstallUpdate" style="display:none">↺ Installieren</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Gefahrenzone ───────────────────────────────────────────────── -->
        <div class="st-section">
          ${sectionHeader("Gefahrenzone", icoDanger(), "Irreversible Aktionen — nicht rückgängig zu machen", true)}
          <div class="panel st-panel" style="border-color:var(--red-border)">
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>Preishistorie bereinigen</h4>
                <p>EANs ohne Eintrag der letzten 90 Tage entfernen</p>
              </div>
              <button class="btn btn-sm" id="btnVacuumHistory" style="border-color:var(--red-border);color:var(--red)">Bereinigen</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <h4>Inventory zurücksetzen</h4>
                <p>Alle Artikel dauerhaft löschen</p>
              </div>
              <button class="btn btn-danger btn-sm" id="btnClearInventory">Löschen</button>
            </div>
            <div class="settings-row" style="border:none">
              <div class="settings-row-left">
                <h4>Abmelden</h4>
                <p>Token wird gelöscht, Gerät wird aus der Lizenz entknüpft</p>
              </div>
              <button class="btn btn-danger btn-sm" id="btnSettingsLogout">Logout</button>
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
      { keys: ["Enter"],    desc: "Check starten (im EK-Feld)" },
      { keys: ["Escape"],   desc: "Modal schließen" },
      { keys: ["↑", "↓"],  desc: "Inventar / Listen navigieren" },
      { keys: ["Alt", "F"], desc: "Extension-Panel öffnen / schließen (Browser)" },
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

  // ─── Events ────────────────────────────────────────────────────────────────
  function attachEvents(container, settings) {

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

    // Price history vacuum
    container.querySelector("#btnVacuumHistory")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(
        "Preishistorie bereinigen",
        "EANs ohne Eintrag in den letzten 90 Tagen werden dauerhaft entfernt. Fortfahren?",
        { confirmLabel: "Bereinigen", danger: false }
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
        if (btn) btn.textContent = "Bereinigen";
      }
    });

    // Danger: clear inventory
    container.querySelector("#btnClearInventory")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(
        "Inventory löschen",
        "Wirklich alle Artikel aus dem Inventory löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
        { confirmLabel: "Alles löschen", danger: true }
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
      const ok = await Modal.confirm("Abmelden", "Wirklich ausloggen? Das Gerät wird aus der Lizenz entknüpft.", { confirmLabel: "Ausloggen", danger: true });
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
      btn.disabled = true; btn.textContent = "Prüfe…";
      try { await window.fc?.checkForUpdates?.(); } catch {}
      setTimeout(() => {
        btn.disabled = false; btn.textContent = "Prüfen";
        if (statusEl && !statusEl.dataset.hasUpdate) {
          statusEl.innerHTML = `<span class="text-green">Aktuell ✓</span>`;
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

    // Fallback: extract basic info from JWT claims without a server round-trip
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
      const freeLockedFeatures = [
        "Batch-Analyse & CSV",
        "Analytics-Dashboard",
        "Preisalerts & Webhooks",
        "Multi-Device Sync",
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
                ? `<div class="text-xs" style="color:var(--text-muted);margin-top:3px">Mitglied seit ${since}</div>`
                : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0">
            <span class="profile-plan-badge"
              style="background:${pm.bg};color:${pm.color};border-color:${pm.border}">
              ${plan}
            </span>
            ${plan === "FREE"
              ? `<button class="btn btn-primary btn-sm" style="font-size:11px"
                   onclick="if(typeof navigateTo==='function')navigateTo('upgrade')">Upgrade auf Pro →</button>`
              : ""}
          </div>
        </div>
        <div class="st-plan-grid">
          ${plan !== "FREE"
            ? proFeatures.map(f => `
                <div class="st-plan-feat st-plan-feat--active">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="var(--green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  ${f}
                </div>`).join("")
            : `<div class="st-plan-feat st-plan-feat--active">
                 <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                   <path d="M2 6l3 3 5-5" stroke="var(--green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                 </svg>
                 50 Checks / Tag
               </div>
               ${freeLockedFeatures.map(f => `
                 <div class="st-plan-feat st-plan-feat--locked">
                   <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                     <path d="M3 3l6 6M9 3l-6 6" stroke="var(--text-muted)" stroke-width="1.4" stroke-linecap="round"/>
                   </svg>
                   ${f}
                 </div>`).join("")}
              `
          }
        </div>
      `;
    } catch {
      // If /auth/me fails but we still have a valid token, show basic info from JWT claims.
      // Only show the "not logged in" state if there are no claims at all.
      const name = claims.discord_username || claims.sub || "";
      if (!name) {
        profileSection.innerHTML = `
          <div class="settings-row" style="border:none">
            <div class="settings-row-left">
              <h4>Nicht angemeldet</h4>
              <p>Token abgelaufen oder ungültig</p>
            </div>
            <button class="btn btn-primary btn-sm" onclick="window.location.reload()">Neu einloggen</button>
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
              <div class="text-xs" style="color:var(--text-muted);margin-top:2px">Profil wird geladen…</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  return { mount, unmount };
})();
