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
    const username = payload?.discord_username || _me?.discord_username || _me?.discord_id || "—";
    const plan     = _me?.plan || "free";
    const isPaid   = _me?.license_ok;
    const initial  = username && username !== "—" ? username[0].toUpperCase() : "F";

    const discordId   = payload?.discord_id;
    const avatarHash  = _me?.avatar_hash || null;
    const avatarUrl   = discordId && avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=96`
      : null;

    const dailyChecks = _me?.daily_checks ?? null;
    const dailyLimit  = _me?.daily_limit ?? null;
    const usagePct    = dailyLimit > 0 ? Math.min(100, Math.round((dailyChecks / dailyLimit) * 100)) : 0;
    const usageColor  = usagePct >= 90 ? "var(--red)" : usagePct >= 70 ? "var(--yellow)" : "var(--green)";

    const vatMode = _settings?.tax?.vat_mode || "no_vat";
    const ekMode  = _settings?.tax?.ek_mode  || "gross";

    _el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Einstellungen</h1><p>Konto, Kalkulation &amp; Präferenzen</p></div>
      </div>

      <div class="st-wrapper">

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
                ${!isPaid ? `<a href="https://whop.com/flipcheck" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:11px">Upgrade →</a>` : ""}
              </div>
            </div>
          </div>

          <!-- Usage bar (free plan) -->
          ${dailyLimit != null ? `
          <div class="st-row">
            <div class="st-row-left">
              <div class="st-row-label">Tagesquota</div>
              <div class="st-row-sub">Free-Plan Limit (täglich)</div>
            </div>
            <div class="st-row-right" style="min-width:140px">
              <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;text-align:right">${dailyChecks ?? 0} / ${dailyLimit}</div>
              <div class="usage-bar-wrap">
                <div class="usage-bar-fill" style="width:${usagePct}%;background:${usageColor}"></div>
              </div>
            </div>
          </div>` : ""}

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
