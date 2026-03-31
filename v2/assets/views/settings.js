/* Flipcheck v2 — Settings View (SaaS) — Tabbed Layout */
const SettingsView = (() => {
  let _container    = null;
  let _saveTimer    = null;
  let _activeTab    = "general";
  let _eventsAbort  = null;

  async function mount(container) {
    _container = container;
    const settings = await Storage.getSettings().catch(() => ({}));
    _activeTab = settings._lastSettingsTab || "general";
    container.innerHTML = renderView(settings);
    attachEvents(container, settings);
    loadProfile(container);
  }

  function unmount() {
    _eventsAbort?.abort();
    _eventsAbort = null;
    clearTimeout(_saveTimer);
    _container = null;
  }

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
      _lastSettingsTab: _activeTab,
      analytics: {
        weekly_profit_target:  parseFloat(container.querySelector("#sWeeklyTarget")?.value)  || 0,
        monthly_profit_target: parseFloat(container.querySelector("#sMonthlyTarget")?.value) || 0,
      },
      tax: {
        vat_mode:  container.querySelector("#sVatMode")?.value || "no_vat",
        ek_mode:   container.querySelector("#sEkModeSeg .seg-btn.active")?.dataset.val || "gross",
        ship_mode: container.querySelector("#sShipModeSeg .seg-btn.active")?.dataset.val || "gross",
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
      theme: container.querySelector("#sThemeSeg .seg-btn.active")?.dataset.val || "dark",
      marketplace: {
        ebay_keep_in_stock:            !!container.querySelector("#sEbayKeepInStock")?.checked,
        ebay_auto_relist:              !!container.querySelector("#sEbayAutoRelist")?.checked,
        ebay_relist_interval_days:     parseInt(container.querySelector("#sEbayRelistInterval")?.value || "14"),
        kaufland_keep_in_stock:        !!container.querySelector("#sKlKeepInStock")?.checked,
        kaufland_auto_relist:          !!container.querySelector("#sKlAutoRelist")?.checked,
        kaufland_relist_interval_days: parseInt(container.querySelector("#sKlRelistInterval")?.value || "14"),
      },
      shipping: {
        carrier:        container.querySelector("#sShipCarrier")?.value || "dhl",
        sender_name:    container.querySelector("#sShipSenderName")?.value?.trim() || "",
        sender_street:  container.querySelector("#sShipSenderStreet")?.value?.trim() || "",
        sender_zip:     container.querySelector("#sShipSenderZip")?.value?.trim() || "",
        sender_city:    container.querySelector("#sShipSenderCity")?.value?.trim() || "",
        sender_country: container.querySelector("#sShipSenderCountry")?.value || "DE",
        default_weight: parseFloat(container.querySelector("#sShipDefaultWeight")?.value) || 1.0,
        default_product: container.querySelector("#sShipProduct")?.value || "V01PAK",
        presets: [0,1,2,3].map(i => ({
          name:    container.querySelector(`#sPresetName${i}`)?.value?.trim() || "",
          weight:  parseFloat(container.querySelector(`#sPresetWeight${i}`)?.value) || 0,
          product: container.querySelector(`#sPresetProduct${i}`)?.value || "V01PAK",
          price:   parseFloat(container.querySelector(`#sPresetPrice${i}`)?.value) || 0,
        })).filter(p => p.name && p.weight > 0),
      },
    };
  }

  // ─── Tab switching ────────────────────────────────────────────────────────
  function switchTab(container, tabId) {
    _activeTab = tabId;
    container.querySelectorAll(".st-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    container.querySelectorAll(".st-tab-panel").forEach(p => {
      p.style.display = p.dataset.tab === tabId ? "" : "none";
    });
    // Persist last tab
    Storage.saveSettings({ _lastSettingsTab: tabId }).catch(() => {});
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function renderView(s) {
    const profit        = s?.analytics?.weekly_profit_target  || "";
    const monthlyTarget = s?.analytics?.monthly_profit_target || "";
    const vat           = s?.tax?.vat_mode || "no_vat";
    const defaultMarket = s?.defaults?.market || "ebay";
    const defaultMode   = s?.defaults?.flipcheck_mode || "mid";
    const ekMode        = s?.defaults?.ek_mode || "gross";
    const shipMode      = s?.tax?.ship_mode || "gross";
    const ff            = s?.flipcheck_fields || {};
    const fcShipIn      = ff.ship_in   !== false;
    const fcShipOut     = ff.ship_out  !== false;
    const fcPackaging   = ff.packaging === true;
    const fcAdRate      = ff.ad_rate   === true;
    const ship          = s?.shipping || {};

    const tabs = [
      { id: "general",      label: "Allgemein",    icon: icoUser() },
      { id: "calculation",  label: "Berechnung",   icon: icoCalc() },
      { id: "marketplaces", label: "Marktplätze",  icon: icoMarket() },
      { id: "shipping",     label: "Versand",      icon: icoTruck() },
      { id: "system",       label: "System",       icon: icoApp() },
    ];

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

      <div class="st-tabs" id="stTabs">
        ${tabs.map(t => `
          <button class="st-tab${t.id === _activeTab ? ' active' : ''}" data-tab="${t.id}">
            ${t.icon}
            <span>${t.label}</span>
          </button>
        `).join("")}
      </div>

      <div class="st-wrapper">

        <!-- ════════════════════════════════════════════════════════════════════ -->
        <!-- TAB: Allgemein                                                      -->
        <!-- ════════════════════════════════════════════════════════════════════ -->
        <div class="st-tab-panel" data-tab="general" style="${_activeTab !== 'general' ? 'display:none' : ''}">

          <!-- Konto -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.account'), icoUser(), I18N.t('st.section.account.desc'))}
            <div class="panel st-panel" id="profileSection">
              <div class="settings-row settings-row--last st-profile-row">
                <div class="skeleton st-avatar-skel"></div>
                <div class="col gap-8" style="flex:1">
                  <div class="skeleton" style="width:150px;height:14px"></div>
                  <div class="skeleton" style="width:110px;height:11px"></div>
                </div>
                <div class="skeleton st-badge-skel"></div>
              </div>
            </div>
          </div>

          <!-- Sprache -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.lang'), icoGlobe(), I18N.t('st.section.lang.desc'))}
            <div class="panel st-panel">
              <div class="settings-row settings-row--last">
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

          <!-- Design -->
          <div class="st-section">
            ${sectionHeader("Design", icoPalette(), "Farbschema der App")}
            <div class="panel st-panel">
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Theme</h4>
                  <p>Dark oder Light Mode</p>
                </div>
                <div class="seg" id="sThemeSeg">
                  <button class="seg-btn ${(s?.theme || "dark") === "dark"   ? "active" : ""}" data-val="dark">Dark</button>
                  <button class="seg-btn ${(s?.theme || "dark") === "light"  ? "active" : ""}" data-val="light">Light</button>
                  <button class="seg-btn ${(s?.theme || "dark") === "system" ? "active" : ""}" data-val="system">System</button>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ════════════════════════════════════════════════════════════════════ -->
        <!-- TAB: Berechnung                                                     -->
        <!-- ════════════════════════════════════════════════════════════════════ -->
        <div class="st-tab-panel" data-tab="calculation" style="${_activeTab !== 'calculation' ? 'display:none' : ''}">

          <!-- Berechnungen -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.calc'), icoCalc(), I18N.t('st.section.calc.desc'))}
            <div class="panel st-panel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.vat.title')}</h4>
                  <p>${I18N.t('st.vat.desc')}</p>
                </div>
                <select id="sVatMode" class="select select--xl">
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
                  <h4>Versandkosten</h4>
                  <p>Gibst du Versandkosten brutto (inkl. MwSt.) oder netto ein?</p>
                </div>
                <div class="seg" id="sShipModeSeg">
                  <button class="seg-btn ${shipMode === "gross" ? "active" : ""}" data-val="gross">Brutto</button>
                  <button class="seg-btn ${shipMode === "net"   ? "active" : ""}" data-val="net">Netto</button>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.market.title')}</h4>
                  <p>${I18N.t('st.market.desc')}</p>
                </div>
                <select id="sDefaultMarket" class="select select--lg">
                  <option value="ebay"     ${defaultMarket === "ebay"     ? "selected" : ""}>eBay</option>
                  <option value="amazon"   ${defaultMarket === "amazon"   ? "selected" : ""}>Amazon</option>
                  <option value="kaufland" ${defaultMarket === "kaufland" ? "selected" : ""}>Kaufland</option>
                </select>
              </div>
              <div class="settings-row settings-row--last">
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

          <!-- Flipcheck Felder -->
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
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.fc_field.ad_rate')}</h4>
                </div>
                <label class="toggle"><input type="checkbox" id="sFcAdRate" ${fcAdRate ? "checked" : ""} /><span class="toggle-slider"></span></label>
              </div>
            </div>
          </div>

          <!-- Analytics -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.analytics'), icoChart(), I18N.t('st.section.analytics.desc'))}
            <div class="panel st-panel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.profit.title')}</h4>
                  <p>${I18N.t('st.profit.desc')}</p>
                </div>
                <div class="input-prefix-wrap input--sm">
                  <span class="prefix">€</span>
                  <input id="sWeeklyTarget" class="input st-input-currency" type="number" min="0" step="10"
                    value="${esc(String(profit))}" />
                </div>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Monatsziel Gewinn</h4>
                  <p>Gewinn-Ziel für den laufenden Monat (0 = deaktiviert). Wird als Fortschrittsbalken in der Sales-View angezeigt.</p>
                </div>
                <div class="input-prefix-wrap input--sm">
                  <span class="prefix">€</span>
                  <input id="sMonthlyTarget" class="input st-input-currency" type="number" min="0" step="10"
                    value="${esc(String(monthlyTarget))}" />
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ════════════════════════════════════════════════════════════════════ -->
        <!-- TAB: Marktplätze                                                    -->
        <!-- ════════════════════════════════════════════════════════════════════ -->
        <div class="st-tab-panel" data-tab="marketplaces" style="${_activeTab !== 'marketplaces' ? 'display:none' : ''}">

          <!-- eBay Seller Sync -->
          <div class="st-section" id="ebaySyncSection">
            ${sectionHeader("eBay Seller Sync", icoSync(), "Automatischer Import von Listings & Verkäufen")}
            <div class="panel st-panel" id="ebaySyncPanel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>eBay-Konto</h4>
                  <p id="ebaySyncConnStatus" style="margin-top:2px">Lade…</p>
                </div>
                <div id="ebaySyncConnBtn"></div>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Auto-Sync</h4>
                  <p>Inventar automatisch mit eBay synchronisieren</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sEbaySyncEnabled" checked /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Sync-Intervall</h4>
                  <p>Wie oft neue Daten von eBay geholt werden</p>
                </div>
                <select id="sEbaySyncInterval" class="select select--md">
                  <option value="15">Alle 15 Min</option>
                  <option value="30" selected>Alle 30 Min</option>
                  <option value="60">Stündlich</option>
                  <option value="360">Alle 6 Std</option>
                </select>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Neue Listings importieren</h4>
                  <p>eBay-Listings ohne Inventar-Eintrag automatisch anlegen</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sEbaySyncAutoCreate" checked /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Letzter Sync</h4>
                  <p id="ebaySyncLastInfo" style="margin-top:2px">—</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="btnEbaySyncNow">Jetzt synchronisieren</button>
              </div>
            </div>
          </div>

          <!-- Kaufland Seller Sync -->
          <div class="st-section" id="kauflandSyncSection">
            ${sectionHeader("Kaufland Seller Sync", icoSync(), "Automatischer Import von Kaufland-Listings & Bestellungen")}
            <div class="panel st-panel" id="kauflandSyncPanel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Kaufland-Konto</h4>
                  <p id="klSyncConnStatus" style="margin-top:2px">Lade…</p>
                </div>
                <div id="klSyncConnBtn"></div>
              </div>
              <div id="klCredsForm" style="display:none">
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>Client Key</h4>
                    <p>Aus dem Kaufland Seller Portal</p>
                  </div>
                  <input type="text" id="sKlClientKey" class="input input--md" placeholder="Client Key" />
                </div>
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>Secret Key</h4>
                    <p>Geheimer API-Schlüssel</p>
                  </div>
                  <input type="password" id="sKlSecretKey" class="input input--md" placeholder="Secret Key" />
                </div>
                <div class="settings-row settings-row--last">
                  <div class="settings-row-left"></div>
                  <button class="btn btn-primary btn-sm" id="btnKlConnect">Verbinden</button>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Auto-Sync</h4>
                  <p>Inventar automatisch mit Kaufland synchronisieren</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sKlSyncEnabled" checked /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Sync-Intervall</h4>
                  <p>Wie oft neue Daten von Kaufland geholt werden</p>
                </div>
                <select id="sKlSyncInterval" class="select select--md">
                  <option value="15">Alle 15 Min</option>
                  <option value="30" selected>Alle 30 Min</option>
                  <option value="60">Stündlich</option>
                  <option value="360">Alle 6 Std</option>
                </select>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Neue Listings importieren</h4>
                  <p>Kaufland-Units ohne Inventar-Eintrag automatisch anlegen</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sKlSyncAutoCreate" checked /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Letzter Sync</h4>
                  <p id="klSyncLastInfo" style="margin-top:2px">—</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="btnKlSyncNow">Jetzt synchronisieren</button>
              </div>
            </div>
          </div>

          <!-- Marktplatz-Optionen -->
          <div class="st-section">
            ${sectionHeader("Marktplatz-Optionen", icoMarket(), "Listing-Verhalten für eBay & Kaufland steuern")}
            <div class="panel st-panel">

              <div class="st-sub-header">
                <div class="st-sub-label">eBay</div>
              </div>

              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Immer auf Lager (Out-of-Stock)</h4>
                  <p>Listings bleiben aktiv, auch wenn Bestand = 0. eBay zeigt "Vorübergehend nicht verfügbar" statt das Angebot zu beenden.</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sEbayKeepInStock" ${(s?.marketplace?.ebay_keep_in_stock) ? "checked" : ""} /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Auto-Wiedereinstellen</h4>
                  <p>Beendete/abgelaufene Listings automatisch neu einstellen</p>
                </div>
                <div class="row gap-12">
                  <label class="toggle"><input type="checkbox" id="sEbayAutoRelist" ${(s?.marketplace?.ebay_auto_relist) ? "checked" : ""} /><span class="toggle-slider"></span></label>
                  <div id="sEbayRelistIntervalWrap" class="interval-wrap${(s?.marketplace?.ebay_auto_relist) ? "" : " interval-wrap--disabled"}">
                    <span class="text-xs text-muted">alle</span>
                    <select id="sEbayRelistInterval" class="select select--sm">
                      <option value="7" ${(s?.marketplace?.ebay_relist_interval_days||14)==7 ? "selected" : ""}>7 Tage</option>
                      <option value="14" ${(s?.marketplace?.ebay_relist_interval_days||14)==14 ? "selected" : ""}>14 Tage</option>
                      <option value="21" ${(s?.marketplace?.ebay_relist_interval_days||14)==21 ? "selected" : ""}>21 Tage</option>
                      <option value="30" ${(s?.marketplace?.ebay_relist_interval_days||14)==30 ? "selected" : ""}>30 Tage</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="st-sub-header">
                <div class="st-sub-label">Kaufland</div>
              </div>

              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Immer auf Lager (Out-of-Stock)</h4>
                  <p>Units bleiben aktiv, auch wenn Bestand = 0. Kaufland zeigt das Angebot weiterhin an.</p>
                </div>
                <label class="toggle"><input type="checkbox" id="sKlKeepInStock" ${(s?.marketplace?.kaufland_keep_in_stock) ? "checked" : ""} /><span class="toggle-slider"></span></label>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Auto-Wiedereinstellen</h4>
                  <p>Inaktive Units automatisch reaktivieren</p>
                </div>
                <div class="row gap-12">
                  <label class="toggle"><input type="checkbox" id="sKlAutoRelist" ${(s?.marketplace?.kaufland_auto_relist) ? "checked" : ""} /><span class="toggle-slider"></span></label>
                  <div id="sKlRelistIntervalWrap" class="interval-wrap${(s?.marketplace?.kaufland_auto_relist) ? "" : " interval-wrap--disabled"}">
                    <span class="text-xs text-muted">alle</span>
                    <select id="sKlRelistInterval" class="select select--sm">
                      <option value="7" ${(s?.marketplace?.kaufland_relist_interval_days||14)==7 ? "selected" : ""}>7 Tage</option>
                      <option value="14" ${(s?.marketplace?.kaufland_relist_interval_days||14)==14 ? "selected" : ""}>14 Tage</option>
                      <option value="21" ${(s?.marketplace?.kaufland_relist_interval_days||14)==21 ? "selected" : ""}>21 Tage</option>
                      <option value="30" ${(s?.marketplace?.kaufland_relist_interval_days||14)==30 ? "selected" : ""}>30 Tage</option>
                    </select>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>

        <!-- ════════════════════════════════════════════════════════════════════ -->
        <!-- TAB: Versand                                                        -->
        <!-- ════════════════════════════════════════════════════════════════════ -->
        <div class="st-tab-panel" data-tab="shipping" style="${_activeTab !== 'shipping' ? 'display:none' : ''}">

          <!-- DHL API-Verbindung -->
          <div class="st-section" id="shippingSection">
            ${sectionHeader("DHL Versand", icoTruck(), "Versandlabels direkt aus dem Inventory erstellen")}
            <div class="panel st-panel" id="shippingPanel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>DHL-Konto</h4>
                  <p id="dhlConnStatus" style="margin-top:2px">Lade…</p>
                </div>
                <div id="dhlConnBtn"></div>
              </div>
              <div id="dhlCredsForm" style="display:none">
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>API Key</h4>
                    <p>Aus dem <a href="https://developer.dhl.com" target="_blank" rel="noopener" class="text-accent">DHL Developer Portal</a></p>
                  </div>
                  <input type="text" id="sDhlApiKey" class="input input--md" placeholder="dhl-api-key" />
                </div>
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>Geschäftskunden-Nr.</h4>
                    <p>EKP-Nummer (10-stellig)</p>
                  </div>
                  <input type="text" id="sDhlEkp" class="input input--sm" placeholder="2222222222" maxlength="10" />
                </div>
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>Benutzername</h4>
                    <p>GKP Web-Service Benutzername</p>
                  </div>
                  <input type="text" id="sDhlUser" class="input input--md" placeholder="user-123" />
                </div>
                <div class="settings-row">
                  <div class="settings-row-left">
                    <h4>Passwort</h4>
                    <p>GKP Web-Service Passwort</p>
                  </div>
                  <input type="password" id="sDhlPass" class="input input--md" placeholder="Passwort" />
                </div>
                <div class="settings-row settings-row--last">
                  <div class="settings-row-left"></div>
                  <button class="btn btn-primary btn-sm" id="btnDhlConnect">Verbinden</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Absender-Adresse -->
          <div class="st-section">
            ${sectionHeader("Absender-Adresse", icoHome(), "Standard-Absender für alle Sendungen")}
            <div class="panel st-panel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Name / Firma</h4>
                </div>
                <input type="text" id="sShipSenderName" class="input input--md" value="${esc(ship.sender_name || "")}" placeholder="Max Mustermann" />
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Straße + Nr.</h4>
                </div>
                <input type="text" id="sShipSenderStreet" class="input input--md" value="${esc(ship.sender_street || "")}" placeholder="Musterstr. 1" />
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>PLZ</h4>
                </div>
                <input type="text" id="sShipSenderZip" class="input input--sm" value="${esc(ship.sender_zip || "")}" placeholder="12345" maxlength="5" />
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Stadt</h4>
                </div>
                <input type="text" id="sShipSenderCity" class="input input--md" value="${esc(ship.sender_city || "")}" placeholder="Berlin" />
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Land</h4>
                </div>
                <select id="sShipSenderCountry" class="select select--sm">
                  <option value="DE" ${(ship.sender_country||"DE")==="DE" ? "selected" : ""}>Deutschland</option>
                  <option value="AT" ${(ship.sender_country)==="AT" ? "selected" : ""}>Österreich</option>
                  <option value="CH" ${(ship.sender_country)==="CH" ? "selected" : ""}>Schweiz</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Versand-Defaults -->
          <div class="st-section">
            ${sectionHeader("Versand-Optionen", icoPackage(), "Standard-Einstellungen für neue Sendungen")}
            <div class="panel st-panel">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>Standard-Gewicht</h4>
                  <p>Gewicht in kg, wenn kein Preset gewählt</p>
                </div>
                <div class="input-prefix-wrap input--sm">
                  <span class="prefix">kg</span>
                  <input id="sShipDefaultWeight" class="input st-input-currency" type="number" min="0.1" step="0.1"
                    value="${ship.default_weight || 1.0}" />
                </div>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>Standard-Produkt</h4>
                  <p>DHL-Versandprodukt wenn kein Preset</p>
                </div>
                <select id="sShipProduct" class="select select--xl">
                  <option value="V01PAK" ${(ship.default_product||"V01PAK")==="V01PAK" ? "selected" : ""}>DHL Paket</option>
                  <option value="V62WP"  ${(ship.default_product)==="V62WP"  ? "selected" : ""}>DHL Warenpost</option>
                  <option value="V01PRIO" ${(ship.default_product)==="V01PRIO" ? "selected" : ""}>DHL Paket Prio</option>
                  <option value="V86PARCEL" ${(ship.default_product)==="V86PARCEL" ? "selected" : ""}>DHL Kleinpaket</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Paketgrößen-Presets -->
          <div class="st-section">
            ${sectionHeader("Paketgrößen-Presets", icoPackage(), "Bis zu 4 Presets definieren — im Versand-Dialog per Klick auswählen")}
            <div class="panel st-panel">
              ${[0,1,2,3].map(i => {
                const p = (ship.presets || [])[i] || {};
                const isLast = i === 3;
                return `<div class="settings-row${isLast ? " settings-row--last" : ""}">
                  <div class="settings-row-left">
                    <h4>Preset ${i + 1}</h4>
                  </div>
                  <div class="row gap-6" style="flex:1;max-width:520px">
                    <input id="sPresetName${i}" class="input" style="width:70px" placeholder="z.B. S" value="${esc(p.name||"")}" />
                    <div class="input-prefix-wrap" style="width:90px">
                      <span class="prefix">kg</span>
                      <input id="sPresetWeight${i}" class="input st-input-currency" type="number" min="0.1" step="0.1" placeholder="0.5" value="${p.weight||""}" />
                    </div>
                    <select id="sPresetProduct${i}" class="select" style="flex:1">
                      <option value="V01PAK"    ${(p.product||"V01PAK")==="V01PAK"    ? "selected":""}>DHL Paket</option>
                      <option value="V62WP"     ${p.product==="V62WP"     ? "selected":""}>Warenpost</option>
                      <option value="V01PRIO"   ${p.product==="V01PRIO"   ? "selected":""}>Paket Prio</option>
                      <option value="V86PARCEL" ${p.product==="V86PARCEL" ? "selected":""}>Kleinpaket</option>
                    </select>
                    <div class="input-prefix-wrap" style="width:90px">
                      <span class="prefix">€</span>
                      <input id="sPresetPrice${i}" class="input st-input-currency" type="number" min="0" step="0.01" placeholder="4.99" value="${p.price||""}" />
                    </div>
                  </div>
                </div>`;
              }).join("")}
            </div>
          </div>

        </div>

        <!-- ════════════════════════════════════════════════════════════════════ -->
        <!-- TAB: System                                                         -->
        <!-- ════════════════════════════════════════════════════════════════════ -->
        <div class="st-tab-panel" data-tab="system" style="${_activeTab !== 'system' ? 'display:none' : ''}">

          <!-- Shortcuts -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.shortcuts'), icoKeyboard(), I18N.t('st.section.shortcuts.desc'))}
            <div class="panel st-panel">
              ${renderShortcuts()}
            </div>
          </div>

          <!-- App & Updates -->
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
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.update.title')}</h4>
                  <p>${I18N.t('st.update.desc')}</p>
                </div>
                <div class="row gap-8">
                  <button class="btn btn-secondary btn-sm" id="btnCheckUpdates">${I18N.t('st.update.check')}</button>
                  <button class="btn btn-primary btn-sm" id="btnInstallUpdate" style="display:none">${I18N.t('st.update.install')}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Gefahrenzone -->
          <div class="st-section">
            ${sectionHeader(I18N.t('st.section.danger'), icoDanger(), I18N.t('st.section.danger.desc'), true)}
            <div class="panel st-panel st-panel--danger">
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.danger.history.title')}</h4>
                  <p>${I18N.t('st.danger.history.desc')}</p>
                </div>
                <button class="btn btn-sm st-btn-danger-outline" id="btnVacuumHistory">${I18N.t('st.danger.history.btn')}</button>
              </div>
              <div class="settings-row">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.danger.inventory.title')}</h4>
                  <p>${I18N.t('st.danger.inventory.desc')}</p>
                </div>
                <button class="btn btn-danger btn-sm" id="btnClearInventory">${I18N.t('st.danger.inventory.btn')}</button>
              </div>
              <div class="settings-row settings-row--last">
                <div class="settings-row-left">
                  <h4>${I18N.t('st.danger.logout.title')}</h4>
                  <p>${I18N.t('st.danger.logout.desc')}</p>
                </div>
                <button class="btn btn-danger btn-sm" id="btnSettingsLogout">${I18N.t('st.danger.logout.btn')}</button>
              </div>
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
      <div class="settings-row${i === rows.length - 1 ? ' settings-row--last' : ''}">
        <div class="settings-row-left">
          <h4>${r.desc}</h4>
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
  function icoPalette() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="10" cy="6" r="1" fill="currentColor"/>
      <circle cx="5.5" cy="9" r="1" fill="currentColor"/><circle cx="10.5" cy="9" r="1" fill="currentColor"/>
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
  function icoMarket() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M1 6l2-4h10l2 4M1 6h14M1 6v8h14V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 10v4M10 10v4M6 6v4M10 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoSync() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M12 2v3h-3M4 11v3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function icoTruck() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M1 3h9v8H1zM10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <circle cx="4" cy="12" r="1.2" stroke="currentColor" stroke-width="1.3"/>
      <circle cx="12.5" cy="12" r="1.2" stroke="currentColor" stroke-width="1.3"/>
    </svg>`;
  }
  function icoHome() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2 7.5L8 2l6 5.5V14H2V7.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M6 14V9h4v5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`;
  }
  function icoPackage() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M2 5l6 3 6-3M8 8v6.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`;
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function attachEvents(container, settings) {
    _eventsAbort?.abort();
    _eventsAbort = new AbortController();
    const sig = { signal: _eventsAbort.signal };

    // Tab switching
    container.querySelectorAll(".st-tab").forEach(tab => {
      tab.addEventListener("click", () => switchTab(container, tab.dataset.tab), sig);
    });

    // Language selector
    container.querySelectorAll("#stLangSelector .lang-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        I18N.setLang(btn.dataset.lang);
        container.innerHTML = renderView(settings);
        attachEvents(container, settings);
        loadProfile(container);
      }, sig);
    });

    // Seg buttons → auto-save
    ["#sEkModeSeg", "#sShipModeSeg", "#sModeSeg", "#sThemeSeg"].forEach(id => {
      container.querySelectorAll(`${id} .seg-btn`).forEach(btn => {
        btn.addEventListener("click", () => {
          container.querySelectorAll(`${id} .seg-btn`).forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          scheduleSave(container);
          if (id === "#sThemeSeg" && typeof applyTheme === "function") {
            applyTheme(btn.dataset.val);
            if (typeof App !== "undefined") App.settings.theme = btn.dataset.val;
          }
        }, sig);
      });
    });

    // Select / input → auto-save
    ["#sVatMode", "#sDefaultMarket"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container), sig);
    });
    container.querySelector("#sWeeklyTarget")?.addEventListener("input",  () => scheduleSave(container), sig);
    container.querySelector("#sMonthlyTarget")?.addEventListener("input", () => scheduleSave(container), sig);

    // Flipcheck field toggles → auto-save
    ["#sFcShipIn", "#sFcShipOut", "#sFcPackaging", "#sFcAdRate"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container), sig);
    });

    // Marketplace options → auto-save + toggle interval visibility
    ["#sEbayKeepInStock", "#sKlKeepInStock"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container), sig);
    });
    ["#sEbayRelistInterval", "#sKlRelistInterval"].forEach(sel => {
      container.querySelector(sel)?.addEventListener("change", () => scheduleSave(container), sig);
    });
    container.querySelector("#sEbayAutoRelist")?.addEventListener("change", (e) => {
      container.querySelector("#sEbayRelistIntervalWrap")?.classList.toggle("interval-wrap--disabled", !e.target.checked);
      scheduleSave(container);
    }, sig);
    container.querySelector("#sKlAutoRelist")?.addEventListener("change", (e) => {
      container.querySelector("#sKlRelistIntervalWrap")?.classList.toggle("interval-wrap--disabled", !e.target.checked);
      scheduleSave(container);
    }, sig);

    // Shipping fields → auto-save
    ["#sShipSenderName", "#sShipSenderStreet", "#sShipSenderZip", "#sShipSenderCity",
     "#sShipSenderCountry", "#sShipDefaultWeight", "#sShipProduct", "#sShipCarrier"].forEach(sel => {
      const el = container.querySelector(sel);
      if (!el) return;
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => scheduleSave(container), sig);
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
    }, sig);

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
    }, sig);

    // Danger: logout
    container.querySelector("#btnSettingsLogout")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(I18N.t('st.danger.logout.title'), "Wirklich ausloggen? Das Gerät wird aus der Lizenz entknüpft.", { confirmLabel: I18N.t('st.danger.logout.btn'), danger: true });
      if (!ok) return;
      try { await window.fc.logout(); } catch {}
      window.location.reload();
    }, sig);

    // ── eBay Sync section ──────────────────────────────────────────────────
    (async () => {
      try {
        const syncStatus = await window.fc.ebaySyncStatus();
        const connStatus = container.querySelector("#ebaySyncConnStatus");
        const connBtn    = container.querySelector("#ebaySyncConnBtn");
        const enabledCb  = container.querySelector("#sEbaySyncEnabled");
        const intervalSel = container.querySelector("#sEbaySyncInterval");
        const autoCreateCb = container.querySelector("#sEbaySyncAutoCreate");
        const lastInfo   = container.querySelector("#ebaySyncLastInfo");

        if (connStatus) {
          connStatus.textContent = syncStatus.connected
            ? "Verbunden mit eBay Seller Account"
            : "Nicht verbunden";
          connStatus.style.color = syncStatus.connected ? "var(--green)" : "var(--text-muted)";
        }
        if (connBtn) {
          if (syncStatus.connected) {
            connBtn.innerHTML = `<span class="badge badge-connected">● Verbunden</span>`;
          } else {
            connBtn.innerHTML = `<button class="btn btn-primary btn-sm" id="btnEbayConnect">Verbinden</button>`;
            connBtn.querySelector("#btnEbayConnect")?.addEventListener("click", async () => {
              try {
                const url = await window.fc.repricerAuthUrl();
                if (url) window.open(url, "_blank");
              } catch { Toast.error("Fehler", "eBay-Auth URL konnte nicht geladen werden."); }
            });
          }
        }

        if (enabledCb)    enabledCb.checked = syncStatus.enabled !== false;
        if (intervalSel)  intervalSel.value = String(syncStatus.interval_min || 30);
        if (autoCreateCb) autoCreateCb.checked = syncStatus.auto_create !== false;

        if (lastInfo && syncStatus.last_sync_at) {
          const d = new Date(syncStatus.last_sync_at);
          lastInfo.textContent = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        }

        enabledCb?.addEventListener("change", () => window.fc.ebaySyncSetEnabled(enabledCb.checked));
        intervalSel?.addEventListener("change", () => window.fc.ebaySyncSetInterval(parseInt(intervalSel.value)));
        autoCreateCb?.addEventListener("change", async () => {
          const s = await Storage.getSettings();
          await Storage.saveSettings({ ebay_sync: { ...(s.ebay_sync || {}), auto_create: autoCreateCb.checked } });
        });
      } catch (e) {
        console.error("[Settings] eBay sync init error:", e);
      }
    })();

    // Sync Now button
    container.querySelector("#btnEbaySyncNow")?.addEventListener("click", async () => {
      const btn = container.querySelector("#btnEbaySyncNow");
      if (btn) { btn.disabled = true; btn.textContent = "Synchronisiere…"; }
      try {
        const result = await window.fc.ebaySyncRun();
        if (result?.ok && result.stats) {
          const s = result.stats;
          Toast.success("Sync abgeschlossen", `${s.active_fetched} aktiv, ${s.sold_marked} verkauft, ${s.new_items} neu importiert`);
          const lastInfo = container.querySelector("#ebaySyncLastInfo");
          if (lastInfo) lastInfo.textContent = new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } else if (result?.reason === "not_connected") {
          Toast.error("Nicht verbunden", "Bitte zuerst eBay-Konto verbinden.");
        } else {
          Toast.error("Sync-Fehler", result?.error || "Unbekannter Fehler");
        }
      } catch (e) {
        Toast.error("Sync-Fehler", e.message || "Verbindung fehlgeschlagen");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Jetzt synchronisieren"; }
      }
    }, sig);

    // ── Kaufland Sync section ────────────────────────────────────────────────
    (async () => {
      try {
        const klStatus   = await window.fc.kauflandSyncStatus();
        const connStatus = container.querySelector("#klSyncConnStatus");
        const connBtn    = container.querySelector("#klSyncConnBtn");
        const credsForm  = container.querySelector("#klCredsForm");
        const enabledCb  = container.querySelector("#sKlSyncEnabled");
        const intervalSel = container.querySelector("#sKlSyncInterval");
        const autoCreateCb = container.querySelector("#sKlSyncAutoCreate");
        const lastInfo   = container.querySelector("#klSyncLastInfo");

        if (connStatus) {
          connStatus.textContent = klStatus.connected
            ? "Verbunden mit Kaufland Seller API"
            : "Nicht verbunden";
          connStatus.style.color = klStatus.connected ? "var(--green)" : "var(--text-muted)";
        }
        if (connBtn) {
          if (klStatus.connected) {
            connBtn.innerHTML = `<span class="badge badge-connected">● Verbunden</span>
              <button class="btn btn-secondary btn-sm ml-8 text-xs" id="btnKlDisconnect">Trennen</button>`;
            if (credsForm) credsForm.style.display = "none";
            connBtn.querySelector("#btnKlDisconnect")?.addEventListener("click", async () => {
              await window.fc.kauflandDeleteCreds();
              Toast.info("Getrennt", "Kaufland-Verbindung wurde entfernt.");
              if (connStatus) { connStatus.textContent = "Nicht verbunden"; connStatus.style.color = "var(--text-muted)"; }
              if (connBtn) connBtn.innerHTML = `<button class="btn btn-primary btn-sm" id="btnKlShowForm">Verbinden</button>`;
              if (credsForm) credsForm.style.display = "";
              connBtn.querySelector("#btnKlShowForm")?.addEventListener("click", () => { if (credsForm) credsForm.style.display = ""; });
            });
          } else {
            connBtn.innerHTML = `<button class="btn btn-primary btn-sm" id="btnKlShowForm">Verbinden</button>`;
            connBtn.querySelector("#btnKlShowForm")?.addEventListener("click", () => { if (credsForm) credsForm.style.display = ""; });
            if (credsForm) credsForm.style.display = "";
          }
        }

        if (enabledCb)    enabledCb.checked = klStatus.enabled !== false;
        if (intervalSel)  intervalSel.value = String(klStatus.interval_min || 30);
        if (autoCreateCb) autoCreateCb.checked = klStatus.auto_create !== false;

        if (lastInfo && klStatus.last_sync_at) {
          const d = new Date(klStatus.last_sync_at);
          lastInfo.textContent = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        }

        enabledCb?.addEventListener("change", () => window.fc.kauflandSyncSetEnabled(enabledCb.checked));
        intervalSel?.addEventListener("change", () => window.fc.kauflandSyncSetInterval(parseInt(intervalSel.value)));
        autoCreateCb?.addEventListener("change", async () => {
          const s = await Storage.getSettings();
          await Storage.saveSettings({ kaufland_sync: { ...(s.kaufland_sync || {}), auto_create: autoCreateCb.checked } });
        });
      } catch (e) {
        console.error("[Settings] Kaufland sync init error:", e);
      }
    })();

    // Kaufland Connect button
    container.querySelector("#btnKlConnect")?.addEventListener("click", async () => {
      const btn = container.querySelector("#btnKlConnect");
      const ck  = container.querySelector("#sKlClientKey")?.value?.trim();
      const sk  = container.querySelector("#sKlSecretKey")?.value?.trim();
      if (!ck || !sk) { Toast.error("Fehler", "Bitte Client Key und Secret Key eingeben."); return; }
      if (btn) { btn.disabled = true; btn.textContent = "Prüfe…"; }
      try {
        const result = await window.fc.kauflandSaveCreds({ client_key: ck, secret_key: sk });
        if (result?.ok) {
          Toast.success("Verbunden", "Kaufland Seller API erfolgreich verbunden!");
          const connStatus = container.querySelector("#klSyncConnStatus");
          const connBtn    = container.querySelector("#klSyncConnBtn");
          const credsForm  = container.querySelector("#klCredsForm");
          if (connStatus) { connStatus.textContent = "Verbunden mit Kaufland Seller API"; connStatus.style.color = "var(--green)"; }
          if (connBtn) connBtn.innerHTML = `<span class="badge badge-connected">● Verbunden</span>`;
          if (credsForm) credsForm.style.display = "none";
        } else {
          Toast.error("Verbindung fehlgeschlagen", result?.error || "Client Key oder Secret Key ungültig.");
        }
      } catch (e) {
        Toast.error("Fehler", e.message || "Verbindung fehlgeschlagen");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Verbinden"; }
      }
    }, sig);

    // Kaufland Sync Now button
    container.querySelector("#btnKlSyncNow")?.addEventListener("click", async () => {
      const btn = container.querySelector("#btnKlSyncNow");
      if (btn) { btn.disabled = true; btn.textContent = "Synchronisiere…"; }
      try {
        const result = await window.fc.kauflandSyncRun();
        if (result?.ok && result.stats) {
          const s = result.stats;
          Toast.success("Sync abgeschlossen", `${s.active_fetched} aktiv, ${s.sold_marked} verkauft, ${s.new_items} neu importiert`);
          const lastInfo = container.querySelector("#klSyncLastInfo");
          if (lastInfo) lastInfo.textContent = new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } else if (result?.reason === "not_connected") {
          Toast.error("Nicht verbunden", "Bitte zuerst Kaufland-Konto verbinden.");
        } else {
          Toast.error("Sync-Fehler", result?.error || "Unbekannter Fehler");
        }
      } catch (e) {
        Toast.error("Sync-Fehler", e.message || "Verbindung fehlgeschlagen");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Jetzt synchronisieren"; }
      }
    }, sig);

    // ── DHL Shipping section ──────────────────────────────────────────────────
    (async () => {
      try {
        const dhlStatus  = await window.fc.dhlStatus().catch(() => ({ connected: false }));
        const connStatus = container.querySelector("#dhlConnStatus");
        const connBtn    = container.querySelector("#dhlConnBtn");
        const credsForm  = container.querySelector("#dhlCredsForm");

        if (connStatus) {
          connStatus.textContent = dhlStatus.connected
            ? "Verbunden mit DHL Geschäftskundenportal"
            : "Nicht verbunden";
          connStatus.style.color = dhlStatus.connected ? "var(--green)" : "var(--text-muted)";
        }
        if (connBtn) {
          if (dhlStatus.connected) {
            connBtn.innerHTML = `<span class="badge badge-connected">● Verbunden</span>
              <button class="btn btn-secondary btn-sm ml-8 text-xs" id="btnDhlDisconnect">Trennen</button>`;
            if (credsForm) credsForm.style.display = "none";
            connBtn.querySelector("#btnDhlDisconnect")?.addEventListener("click", async () => {
              await window.fc.dhlDeleteCreds();
              Toast.info("Getrennt", "DHL-Verbindung wurde entfernt.");
              if (connStatus) { connStatus.textContent = "Nicht verbunden"; connStatus.style.color = "var(--text-muted)"; }
              if (connBtn) connBtn.innerHTML = `<button class="btn btn-primary btn-sm" id="btnDhlShowForm">Verbinden</button>`;
              if (credsForm) credsForm.style.display = "";
              connBtn.querySelector("#btnDhlShowForm")?.addEventListener("click", () => { if (credsForm) credsForm.style.display = ""; });
            });
          } else {
            connBtn.innerHTML = `<button class="btn btn-primary btn-sm" id="btnDhlShowForm">Verbinden</button>`;
            connBtn.querySelector("#btnDhlShowForm")?.addEventListener("click", () => { if (credsForm) credsForm.style.display = ""; });
            if (credsForm) credsForm.style.display = "";
          }
        }
      } catch (e) {
        console.error("[Settings] DHL init error:", e);
        const connStatus = container.querySelector("#dhlConnStatus");
        if (connStatus) { connStatus.textContent = "Nicht verbunden"; connStatus.style.color = "var(--text-muted)"; }
        const credsForm = container.querySelector("#dhlCredsForm");
        if (credsForm) credsForm.style.display = "";
      }
    })();

    // DHL Connect button
    container.querySelector("#btnDhlConnect")?.addEventListener("click", async () => {
      const btn    = container.querySelector("#btnDhlConnect");
      const apiKey = container.querySelector("#sDhlApiKey")?.value?.trim();
      const ekp    = container.querySelector("#sDhlEkp")?.value?.trim();
      const user   = container.querySelector("#sDhlUser")?.value?.trim();
      const pass   = container.querySelector("#sDhlPass")?.value?.trim();
      if (!apiKey || !ekp || !user || !pass) { Toast.error("Fehler", "Bitte alle DHL-Felder ausfüllen."); return; }
      if (btn) { btn.disabled = true; btn.textContent = "Prüfe…"; }
      try {
        const result = await window.fc.dhlSaveCreds({ api_key: apiKey, ekp, username: user, password: pass });
        if (result?.ok) {
          Toast.success("Verbunden", "DHL Geschäftskundenportal erfolgreich verbunden!");
          const connStatus = container.querySelector("#dhlConnStatus");
          const connBtn    = container.querySelector("#dhlConnBtn");
          const credsForm  = container.querySelector("#dhlCredsForm");
          if (connStatus) { connStatus.textContent = "Verbunden mit DHL Geschäftskundenportal"; connStatus.style.color = "var(--green)"; }
          if (connBtn) connBtn.innerHTML = `<span class="badge badge-connected">● Verbunden</span>`;
          if (credsForm) credsForm.style.display = "none";
        } else {
          Toast.error("Verbindung fehlgeschlagen", result?.error || "DHL-Credentials ungültig.");
        }
      } catch (e) {
        Toast.error("Fehler", e.message || "Verbindung fehlgeschlagen");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Verbinden"; }
      }
    }, sig);

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
    }, sig);

    container.querySelector("#btnInstallUpdate")?.addEventListener("click", () => {
      window.fc?.installUpdate?.();
    }, sig);

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
          <div class="settings-row settings-row--last">
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
