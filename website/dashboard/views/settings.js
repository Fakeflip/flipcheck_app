/* Flipcheck Web App — Settings View (v2 quality) */
const SettingsView = (() => {
  let _el       = null;
  let _me       = null;
  let _settings = {};
  let _autoSaveTimer = null;

  /* ── Mount ───────────────────────────────────────────────────────── */
  async function mount(el, navId) {
    _el = el;
    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Einstellungen</h1></div>
      </div>
      <div class="view-loading">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" class="spin">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
        </svg>
      </div>`;

    const [me, settings] = await Promise.all([
      API.call("/auth/me").catch(() => null),
      Storage.getSettings().catch(() => ({})),
    ]);

    if (App._navId !== navId) return;
    _me = me;
    _settings = settings || {};

    render();
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  function render() {
    const payload  = Auth.getPayload();
    const username = _me?.username || payload?.discord_username || _me?.discord_id || "—";
    const isPaid   = _me?.license_ok;
    const licStatus = (_me?.license_status || "").toLowerCase();  // "active","trialing","past_due",""
    const avatarUrl = _me?.avatar_url || null;
    const initial   = username && username !== "—" ? username[0].toUpperCase() : "F";

    const vatMode = _settings?.tax?.vat_mode || "no_vat";
    const ekMode  = _settings?.tax?.ek_mode  || "gross";

    // ── Abo block ──────────────────────────────────────────────────
    const arrowSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
    const extSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

    let aboBlock;
    if (isPaid && (licStatus === "active" || licStatus === "trialing")) {
      const badgeLabel = licStatus === "trialing" ? "✦ Trial aktiv" : "✦ Pro aktiv";
      const badgeColor = licStatus === "trialing" ? "st-plan-trial" : "st-plan-pro";
      aboBlock = `
        <div class="st-abo-card st-abo-active">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="st-plan-badge ${badgeColor}" style="font-size:13px;padding:5px 12px">${badgeLabel}</span>
            <span style="font-size:13px;color:var(--text-secondary)">
              ${licStatus === "trialing" ? "Dein Probeabo läuft — nach dem Trial € 19,99/Monat." : "Dein Flipcheck Pro-Abo ist aktiv."}
            </span>
          </div>
          <button id="sManageSub" class="btn btn-ghost btn-sm" style="margin-top:12px;display:inline-flex;align-items:center;gap:6px">
            Abo verwalten ${extSvg}
          </button>
        </div>`;
    } else if (isPaid) {
      // license_ok but status unknown — treat as active
      aboBlock = `
        <div class="st-abo-card st-abo-active">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="st-plan-badge st-plan-pro" style="font-size:13px;padding:5px 12px">✦ Pro aktiv</span>
            <span style="font-size:13px;color:var(--text-secondary)">Dein Flipcheck Pro-Abo ist aktiv.</span>
          </div>
          <button id="sManageSub" class="btn btn-ghost btn-sm" style="margin-top:12px;display:inline-flex;align-items:center;gap:6px">
            Abo verwalten ${extSvg}
          </button>
        </div>`;
    } else if (licStatus === "past_due") {
      aboBlock = `
        <div class="st-abo-card st-abo-inactive">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="st-plan-badge" style="background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.25);font-size:13px;padding:5px 12px">⚠ Zahlung ausstehend</span>
            <span style="font-size:13px;color:var(--text-secondary)">Bitte aktualisiere deine Zahlungsmethode.</span>
          </div>
          <button id="sManageSub" class="btn btn-primary btn-sm" style="margin-top:12px;display:inline-flex;align-items:center;gap:6px">
            Zahlung aktualisieren ${extSvg}
          </button>
        </div>`;
    } else {
      aboBlock = `
        <div class="st-abo-card st-abo-inactive">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="width:40px;height:40px;border-radius:10px;background:rgba(99,102,241,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">Kein aktiver Plan</div>
              <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;max-width:360px">
                Wähle einen Plan um unbegrenzte Flipchecks, Inventar, Preisverlauf und alle Pro-Features freizuschalten.
              </div>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <button id="sBtnTrial" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px">
              7 Tage kostenlos testen ${arrowSvg}
            </button>
            <button id="sBtnBuy" class="btn btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px">
              Direkt kaufen · € 19,99/Mo ${arrowSvg}
            </button>
          </div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Kein Risiko · Jederzeit kündbar</p>
        </div>`;
    }

    _el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Einstellungen</h1><p>Abo, Konto &amp; Kalkulation</p></div>
      </div>

      <div class="st-wrapper">

        <!-- ── Abonnement ────────────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Abonnement</div>
          ${aboBlock}
        </div>

        <!-- ── Profil ───────────────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Profil</div>
          <div class="st-profile-card">
            <div class="st-avatar">
              ${avatarUrl ? `<img src="${esc(avatarUrl)}" alt="${esc(username)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>` : initial}
            </div>
            <div style="flex:1;min-width:0">
              <div class="st-username">${esc(username)}</div>
              <div class="st-plan-row">
                <span class="st-plan-badge ${isPaid ? "st-plan-pro" : "st-plan-free"}">${isPaid ? "✦ Pro" : "Free"}</span>
              </div>
            </div>
          </div>

          <!-- Token exp -->
          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Token-Ablauf</div>
              <div class="st-row-sub">JWT gültig bis</div>
            </div>
            <div class="st-row-right" style="font-size:12px;color:var(--text-muted)">${formatExp(payload?.exp)}</div>
          </div>
        </div>

        <!-- ── Kalkulation ──────────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Kalkulation</div>

          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">MwSt-Modus</div>
              <div class="st-row-sub">Beeinflusst Profit-Berechnung</div>
            </div>
            <div class="st-row-right">
              <select class="select" id="sVatMode" style="width:160px;min-height:36px;padding:5px 10px">
                <option value="no_vat" ${vatMode === "no_vat" ? "selected" : ""}>Keine MwSt (Privat)</option>
                <option value="ust_19" ${vatMode === "ust_19" ? "selected" : ""}>USt 19% (Gewerblich)</option>
              </select>
            </div>
          </div>

          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">EK-Modus</div>
              <div class="st-row-sub">Eingabe als Brutto oder Netto</div>
            </div>
            <div class="st-row-right">
              <select class="select" id="sEkMode" style="width:160px;min-height:36px;padding:5px 10px">
                <option value="gross" ${ekMode === "gross" ? "selected" : ""}>Brutto (inkl. MwSt)</option>
                <option value="net"   ${ekMode === "net"   ? "selected" : ""}>Netto (exkl. MwSt)</option>
              </select>
            </div>
          </div>

          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Standard-Kategorie</div>
              <div class="st-row-sub">Vorauswahl im Flipcheck</div>
            </div>
            <div class="st-row-right">
              <select class="select" id="sDefaultCat" style="width:160px;min-height:36px;padding:5px 10px">
                <option value="sonstiges" ${(_settings?.defaults?.category || "sonstiges") === "sonstiges" ? "selected" : ""}>Sonstiges</option>
                <option value="konsolen"  ${(_settings?.defaults?.category) === "konsolen"  ? "selected" : ""}>Konsolen</option>
                <option value="handys"    ${(_settings?.defaults?.category) === "handys"    ? "selected" : ""}>Handys</option>
                <option value="computer_tablets" ${(_settings?.defaults?.category) === "computer_tablets" ? "selected" : ""}>Computer / Tablets</option>
              </select>
            </div>
          </div>

          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Standard-Modus</div>
              <div class="st-row-sub">LOW / MID / HIGH Preisniveau</div>
            </div>
            <div class="st-row-right">
              <select class="select" id="sDefaultMode" style="width:160px;min-height:36px;padding:5px 10px">
                <option value="low" ${(_settings?.defaults?.mode) === "low" ? "selected" : ""}>Vorsichtig (LOW)</option>
                <option value="mid" ${(!_settings?.defaults?.mode || _settings?.defaults?.mode === "mid") ? "selected" : ""}>Ausgewogen (MID)</option>
                <option value="high" ${(_settings?.defaults?.mode) === "high" ? "selected" : ""}>Aggressiv (HIGH)</option>
              </select>
            </div>
          </div>

          <div class="st-row" style="border-top:none">
            <div class="st-row-left"></div>
            <div class="st-row-right">
              <div id="sAutoSave" class="st-autosave" style="display:none">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="var(--green)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Gespeichert
              </div>
              <button class="btn btn-primary btn-sm" id="sSave" style="min-width:100px">Speichern</button>
            </div>
          </div>
        </div>

        <!-- ── Features (Pro) ──────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Features</div>
          <div class="st-feature-grid">
            ${featureItem("▲", "Flipcheck", "EAN/ASIN → BUY/HOLD/SKIP", true)}
            ${featureItem("📦", "Amazon-Check", "Buy Box, BSR, FBA-Kalkulation", isPaid)}
            ${featureItem("📊", "Analytics", "Profit, ROI, Win Rate", true)}
            ${featureItem("🔔", "Preisalarme", "Benachrichtigung bei Zielpreis", true)}
            ${featureItem("📈", "Preisverlauf", "90-Tage Verlauf pro EAN", true)}
            ${featureItem("🗃️", "Cloud-Sync", "Sync auf allen Geräten", true)}
          </div>
        </div>

        <!-- ── Shortcuts ────────────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Tastenkürzel</div>
          <div class="st-shortcuts-table">
            ${shortcut("1–5", "Navigation zwischen Views")}
            ${shortcut("Enter", "Flipcheck starten")}
            ${shortcut("⌘ K", "Suche öffnen (bald)")}
          </div>
        </div>

        <!-- ── Konto ─────────────────────────────────────── -->
        <div class="st-section">
          <div class="st-section-head">Konto</div>
          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Discord Community</div>
              <div class="st-row-sub">Support, Updates &amp; Pro-Plan</div>
            </div>
            <div class="st-row-right">
              <a href="https://discord.gg/AUYvAsebA3" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Server beitreten</a>
            </div>
          </div>
          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Abmelden</div>
              <div class="st-row-sub">Token aus Browser löschen</div>
            </div>
            <div class="st-row-right">
              <button class="btn btn-danger btn-sm" id="sLogout">Abmelden</button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align:center;font-size:11px;color:var(--text-muted);margin-top:8px;padding-bottom:32px">
          Flipcheck Web App ·
          <a href="https://joinflipcheck.app/datenschutz" target="_blank" rel="noopener">Datenschutz</a> ·
          <a href="https://joinflipcheck.app/impressum" target="_blank" rel="noopener">Impressum</a>
        </div>

      </div>
    `;

    bindEvents();
  }

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function featureItem(icon, title, desc, active) {
    return `
      <div class="st-feature-item${active ? "" : " st-feature-locked"}">
        <div style="font-size:20px;line-height:1">${icon}</div>
        <div style="font-size:12px;font-weight:600;margin-top:4px">${esc(title)}</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${esc(desc)}</div>
        ${!active ? `<div style="font-size:10px;color:var(--accent);margin-top:4px;font-weight:600">PRO</div>` : ""}
      </div>`;
  }

  function shortcut(keys, label) {
    const keyParts = keys.split(" ").map(k => `<span class="st-kbd">${esc(k)}</span>`).join(" ");
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text-secondary)">${esc(label)}</span>
        <span style="display:flex;gap:4px;align-items:center">${keyParts}</span>
      </div>`;
  }

  function formatExp(exp) {
    if (!exp) return "—";
    try {
      return new Date(exp * 1000).toLocaleString("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return "—"; }
  }

  /* ── Auto-save ───────────────────────────────────────────────────── */
  function triggerAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(async () => {
      await doSave(true);
    }, 800);
  }

  async function doSave(silent = false) {
    const vatMode = _el?.querySelector("#sVatMode")?.value;
    const ekMode  = _el?.querySelector("#sEkMode")?.value;
    const defCat  = _el?.querySelector("#sDefaultCat")?.value;
    const defMode = _el?.querySelector("#sDefaultMode")?.value;
    try {
      await Storage.saveSettings({
        tax:      { vat_mode: vatMode, ek_mode: ekMode },
        defaults: { category: defCat, mode: defMode },
      });
      if (silent) {
        const badge = _el?.querySelector("#sAutoSave");
        if (badge) {
          badge.style.display = "flex";
          clearTimeout(badge._t);
          badge._t = setTimeout(() => { badge.style.display = "none"; }, 2000);
        }
      } else {
        Toast.success("Einstellungen gespeichert");
      }
    } catch (e) {
      if (!silent) Toast.error("Fehler", e.message);
    }
  }

  /* ── Bind events ─────────────────────────────────────────────────── */
  function bindEvents() {
    // Manual save
    _el?.querySelector("#sSave")?.addEventListener("click", () => doSave(false));

    // Auto-save on change
    ["#sVatMode", "#sEkMode", "#sDefaultCat", "#sDefaultMode"].forEach(sel => {
      _el?.querySelector(sel)?.addEventListener("change", triggerAutoSave);
    });

    // Abo buttons
    async function handleCheckout(btn, trialDays, resetHtml) {
      if (!btn) return;
      btn.disabled = true; btn.textContent = "Lade…";
      try {
        const data = await createCheckoutSession(trialDays);
        if (data?.checkout_url) window.open(data.checkout_url, "_blank");
        else Toast.error("Fehler", "Checkout konnte nicht geöffnet werden.");
      } catch { Toast.error("Fehler", "Verbindung fehlgeschlagen."); }
      btn.disabled = false; btn.innerHTML = resetHtml;
    }

    const arrowSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
    const extSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

    _el?.querySelector("#sBtnTrial")?.addEventListener("click", function() {
      handleCheckout(this, 7, `7 Tage kostenlos testen ${arrowSvg}`);
    });
    _el?.querySelector("#sBtnBuy")?.addEventListener("click", function() {
      handleCheckout(this, 0, `Direkt kaufen · € 19,99/Mo ${arrowSvg}`);
    });
    _el?.querySelector("#sManageSub")?.addEventListener("click", async function() {
      this.disabled = true; this.textContent = "Lade…";
      try {
        const data = await createPortalSession();
        if (data?.portal_url) window.open(data.portal_url, "_blank");
        else Toast.error("Fehler", "Stripe-Portal konnte nicht geöffnet werden.");
      } catch { Toast.error("Fehler", "Verbindung fehlgeschlagen."); }
      this.disabled = false; this.innerHTML = `Abo verwalten ${extSvg}`;
    });

    // Logout
    _el?.querySelector("#sLogout")?.addEventListener("click", async () => {
      const ok = await Modal.confirm("Abmelden", "Möchtest du dich wirklich abmelden?", { confirmLabel: "Abmelden", danger: true });
      if (!ok) return;
      Auth.clear();
      location.reload();
    });
  }

  /* ── Unmount ─────────────────────────────────────────────────────── */
  function unmount() {
    clearTimeout(_autoSaveTimer);
    _el = null;
  }

  return { mount, unmount };
})();
