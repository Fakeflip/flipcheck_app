/* Flipcheck v2 — Onboarding Wizard (SaaS) */
const OnboardingWizard = (() => {
  let _resolve = null;
  let _step    = 1;
  let _draft   = { vat_mode: "no_vat", ek_mode: "gross", flipcheck_mode: "mid" };

  const TOTAL_STEPS = 4;

  function stepLabels() {
    return [
      I18N.t('ob.step.welcome'),
      I18N.t('ob.step.tax'),
      I18N.t('ob.step.mode'),
      I18N.t('ob.step.done'),
    ];
  }

  // ── Public ────────────────────────────────────────────────────────────────
  function show() {
    return new Promise(resolve => {
      _resolve = resolve;
      _step    = 1;
      _draft   = { vat_mode: "no_vat", ek_mode: "gross", flipcheck_mode: "mid" };
      const root = document.getElementById("wizard-root");
      if (!root) { resolve(null); return; }
      root.style.display = "flex";
      renderStep(root);
    });
  }

  // ── Renderer ──────────────────────────────────────────────────────────────
  function renderStep(root) {
    root.innerHTML = `
      <div class="wz-card">
        ${buildStepper()}
        <div class="wz-body" id="wzBody">
          ${buildStepHTML(_step)}
        </div>
        <div class="wz-actions" id="wzActions">
          ${buildActions(_step)}
        </div>
      </div>
    `;
    attachStepEvents(root);
  }

  // ── Stepper ───────────────────────────────────────────────────────────────
  function buildStepper() {
    const labels = stepLabels();
    const items = labels.map((label, i) => {
      const n     = i + 1;
      const done  = n < _step;
      const active = n === _step;
      const cls   = done ? "done" : active ? "active" : "";
      const inner = done
        ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
             <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round"/>
           </svg>`
        : n;
      return `
        <div class="wz-step-item ${cls}">
          <div class="wz-step-circle">${inner}</div>
          <div class="wz-step-label">${label}</div>
        </div>
        ${i < TOTAL_STEPS - 1 ? `<div class="wz-step-connector ${done ? "done" : ""}"></div>` : ""}
      `;
    }).join("");
    return `<div class="wz-stepper">${items}</div>`;
  }

  // ── Step builder ──────────────────────────────────────────────────────────
  function buildStepHTML(step) {
    switch (step) {
      case 1: return buildWelcome();
      case 2: return buildTaxStep();
      case 3: return buildModeStep();
      case 4: return buildDoneStep();
      default: return "";
    }
  }

  function buildActions(step) {
    if (step === 1 || step === 4) return `<div></div>`;
    const back = `<button class="btn btn-ghost btn-sm" id="wzBack">${I18N.t('ob.btn.back')}</button>`;
    const next = step < TOTAL_STEPS
      ? `<button class="btn btn-primary" id="wzNext">${I18N.t('ob.btn.next')}</button>`
      : "";
    return `${back}${next}`;
  }

  // ── Step 1: Willkommen ────────────────────────────────────────────────────
  function buildWelcome() {
    const features = [
      {
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 11.5L5.5 7.5 8.5 10 12 5l2.5 2" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        color: "accent",
        title: I18N.t('ob.welcome.feat.market.title'),
        sub:   I18N.t('ob.welcome.feat.market.sub'),
      },
      {
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v4l3 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
        </svg>`,
        color: "green",
        title: I18N.t('ob.welcome.feat.decision.title'),
        sub:   I18N.t('ob.welcome.feat.decision.sub'),
      },
      {
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
        color: "yellow",
        title: I18N.t('ob.welcome.feat.inventory.title'),
        sub:   I18N.t('ob.welcome.feat.inventory.sub'),
      },
    ];

    const colorMap = {
      accent: { bg: "var(--accent-subtle)", border: "var(--accent-border)", color: "var(--accent)" },
      green:  { bg: "var(--green-subtle)",  border: "var(--green-border)",  color: "var(--green)"  },
      yellow: { bg: "var(--yellow-subtle)", border: "var(--yellow-border)", color: "var(--yellow)" },
    };

    const titleLines = I18N.t('ob.welcome.title').split('\n');

    return `
      <div class="wz-welcome">
        <div class="wz-lang-row">
          ${I18N.renderSelector(I18N.getLang())}
        </div>

        <div class="wz-brand">
          <div class="wz-brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z"
                fill="#6366F1" stroke="#6366F1" stroke-width="1" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="wz-brand-name">Flipcheck</span>
        </div>

        <div class="wz-headline-block">
          <h1 class="wz-title">${titleLines.join('<br>')}</h1>
          <p class="wz-subtitle">${I18N.t('ob.welcome.subtitle')}</p>
        </div>

        <div class="wz-features">
          ${features.map(f => {
            const c = colorMap[f.color];
            return `
              <div class="wz-feature">
                <div class="wz-feature-icon-box"
                  style="background:${c.bg};border-color:${c.border};color:${c.color}">
                  ${f.icon}
                </div>
                <div>
                  <div class="wz-feature-title">${f.title}</div>
                  <div class="wz-feature-sub">${f.sub}</div>
                </div>
              </div>`;
          }).join("")}
        </div>

        <button class="btn btn-primary wz-start-btn" id="wzStart">
          ${I18N.t('ob.welcome.start')}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <p class="wz-start-hint">${I18N.t('ob.welcome.hint')}</p>
      </div>
    `;
  }

  // ── Step 2: Steuer & EK-Modus ─────────────────────────────────────────────
  function buildTaxStep() {
    const v = _draft;

    const vatOpts = [
      {
        val:   "no_vat",
        title: I18N.t('ob.tax.vat.no_vat.title'),
        sub:   I18N.t('ob.tax.vat.no_vat.sub'),
        icon:  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M8 2a6 6 0 100 12A6 6 0 008 2z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M6 8h4M8 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
      },
      {
        val:   "ust_19",
        title: I18N.t('ob.tax.vat.ust_19.title'),
        sub:   I18N.t('ob.tax.vat.ust_19.sub'),
        icon:  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 4V3a3 3 0 016 0v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
      },
    ];

    const ekOpts = [
      {
        val:   "gross",
        title: I18N.t('ob.tax.ek.gross.title'),
        sub:   I18N.t('ob.tax.ek.gross.sub'),
        icon:  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M5.5 5.5C5.5 4.12 6.62 3 8 3s2.5 1.12 2.5 2.5S9.38 8 8 8"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M5.5 11h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
      },
      {
        val:   "net",
        title: I18N.t('ob.tax.ek.net.title'),
        sub:   I18N.t('ob.tax.ek.net.sub'),
        icon:  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M2 10l3-6 3 6M3.5 8h3M10 4v8M10 4c2 0 3.5.9 3.5 2s-1.5 2-3.5 2"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
      },
    ];

    return `
      <div class="wz-section">
        <div class="wz-step-header">
          <div class="wz-step-eyebrow">${I18N.t('ob.tax.eyebrow')}</div>
          <h2 class="wz-step-title">${I18N.t('ob.tax.title')}</h2>
          <p class="wz-step-sub">${I18N.t('ob.tax.sub')}</p>
        </div>

        <div class="wz-form">
          <div class="wz-form-group">
            <label class="wz-label">${I18N.t('ob.tax.vat.label')}</label>
            <div class="wz-opt-grid" id="optVat">
              ${vatOpts.map(o => `
                <div class="wz-opt-card ${v.vat_mode === o.val ? "selected" : ""}" data-val="${o.val}">
                  <div class="wz-opt-icon">${o.icon}</div>
                  <div>
                    <div class="wz-opt-title">${o.title}</div>
                    <div class="wz-opt-sub">${o.sub}</div>
                  </div>
                  <div class="wz-opt-radio ${v.vat_mode === o.val ? "on" : ""}"></div>
                </div>`).join("")}
            </div>
          </div>

          <div class="wz-form-group">
            <label class="wz-label">${I18N.t('ob.tax.ek.label')}</label>
            <div class="wz-opt-grid" id="optEk">
              ${ekOpts.map(o => `
                <div class="wz-opt-card ${v.ek_mode === o.val ? "selected" : ""}" data-val="${o.val}">
                  <div class="wz-opt-icon">${o.icon}</div>
                  <div>
                    <div class="wz-opt-title">${o.title}</div>
                    <div class="wz-opt-sub">${o.sub}</div>
                  </div>
                  <div class="wz-opt-radio ${v.ek_mode === o.val ? "on" : ""}"></div>
                </div>`).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Step 3: Analyse-Modus ─────────────────────────────────────────────────
  function buildModeStep() {
    const sel   = _draft.flipcheck_mode;
    const modes = [
      {
        id:    "low",
        label: I18N.t('ob.mode.low.label'),
        badge: null,
        margin: "≥ 25 %",
        roi:   "≥ 30 %",
        desc:  I18N.t('ob.mode.low.desc'),
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L3 5.5v5C3 13.5 5.5 15 8 15s5-1.5 5-4.5v-5L8 2z"
            stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M6 8.5l1.5 1.5 3-3" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        color: "blue",
      },
      {
        id:    "mid",
        label: I18N.t('ob.mode.mid.label'),
        badge: I18N.t('ob.mode.mid.badge'),
        margin: "≥ 15 %",
        roi:   "≥ 20 %",
        desc:  I18N.t('ob.mode.mid.desc'),
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M4 8h8" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
        </svg>`,
        color: "accent",
      },
      {
        id:    "high",
        label: I18N.t('ob.mode.high.label'),
        badge: null,
        margin: "≥ 10 %",
        roi:   "≥ 10 %",
        desc:  I18N.t('ob.mode.high.desc'),
        icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2l1.5 4h4L10 8.5l1.5 4L8 10l-3.5 2.5L6 8.5 2.5 6h4L8 2z"
            stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>`,
        color: "yellow",
      },
    ];

    const colorMap = {
      blue:   { bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.3)", color: "#60A5FA" },
      accent: { bg: "var(--accent-subtle)", border: "var(--accent-border)", color: "var(--accent)" },
      yellow: { bg: "var(--yellow-subtle)", border: "var(--yellow-border)", color: "var(--yellow)" },
    };

    return `
      <div class="wz-section">
        <div class="wz-step-header">
          <div class="wz-step-eyebrow">${I18N.t('ob.mode.eyebrow')}</div>
          <h2 class="wz-step-title">${I18N.t('ob.mode.title')}</h2>
          <p class="wz-step-sub">
            ${I18N.t('ob.mode.sub').replace('BUY', '<strong class="text-green">BUY</strong>')}
          </p>
        </div>

        <div class="wz-mode-grid">
          ${modes.map(m => {
            const c   = colorMap[m.color];
            const act = sel === m.id;
            return `
              <div class="wz-mode-card ${act ? "selected" : ""}" data-mode="${m.id}">
                ${m.badge ? `<span class="wz-mode-badge">${m.badge}</span>` : ""}
                <div class="wz-mode-icon-box"
                  style="background:${c.bg};border-color:${c.border};color:${c.color}">
                  ${m.icon}
                </div>
                <div class="wz-mode-label">${m.label}</div>
                <div class="wz-mode-metrics">
                  <div class="wz-mode-metric">
                    <span class="wz-mode-metric-lbl">${I18N.t('ob.mode.margin')}</span>
                    <span class="wz-mode-metric-val">${m.margin}</span>
                  </div>
                  <div class="wz-mode-metric">
                    <span class="wz-mode-metric-lbl">ROI</span>
                    <span class="wz-mode-metric-val">${m.roi}</span>
                  </div>
                </div>
                <div class="wz-mode-desc">${m.desc}</div>
                <div class="wz-mode-check ${act ? "on" : ""}">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor"
                      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  // ── Step 4: Bereit ────────────────────────────────────────────────────────
  function buildDoneStep() {
    const subLines = I18N.t('ob.done.sub').split('\n');
    return `
      <div class="wz-done">
        <div class="wz-check-wrap">
          <svg class="wz-check-svg" viewBox="0 0 52 52" fill="none">
            <circle class="wz-check-circle" cx="26" cy="26" r="25"
              stroke="#6366F1" stroke-width="2"/>
            <path class="wz-check-tick" d="M14 26l9 9 15-15"
              stroke="#6366F1" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <div class="wz-done-text">
          <h2 class="wz-done-title">${I18N.t('ob.done.title')}</h2>
          <p class="wz-done-sub">${subLines.join('<br>')}</p>
        </div>

        <div class="wz-done-scan">
          <div class="wz-done-scan-label">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M1 5V3a2 2 0 012-2h2M1 11v2a2 2 0 002 2h2M15 5V3a2 2 0 00-2-2h-2M15 11v2a2 2 0 01-2 2h-2"
                stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>
              <rect x="5" y="5" width="6" height="6" rx="1" stroke="var(--accent)" stroke-width="1.5"/>
            </svg>
            ${I18N.t('ob.done.scan.label')} <span class="wz-done-optional">${I18N.t('ob.done.scan.optional')}</span>
          </div>
          <div class="row gap-8">
            <input class="input" id="wzFirstEan"
              placeholder="${I18N.t('ob.done.scan.placeholder')}"
              style="flex:1;font-family:var(--font-mono,monospace);font-size:12px"
              maxlength="14" autocomplete="off" spellcheck="false">
            <button class="btn btn-secondary btn-sm" id="wzScanFirst">${I18N.t('ob.done.scan.btn')}</button>
          </div>
        </div>

        <div class="wz-done-actions">
          <button class="btn btn-primary wz-start-btn" id="wzFinish">
            ${I18N.t('ob.done.finish')}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div class="wz-done-shortcuts">
          <span>${I18N.t('ob.done.next')}</span>
          <span class="wz-done-tip">${I18N.t('ob.done.tip1')}</span>
          <span class="wz-done-tip">${I18N.t('ob.done.tip2')}</span>
        </div>
      </div>
    `;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function attachStepEvents(root) {

    // Language selector buttons (step 1 only)
    root.querySelectorAll(".lang-btn[data-lang]").forEach(btn => {
      btn.addEventListener("click", () => {
        I18N.setLang(btn.dataset.lang, { save: false }); // save on wizard finish
        renderStep(root); // re-render with new language
      });
    });

    // Step 1: "Los geht's" button
    root.querySelector("#wzStart")?.addEventListener("click", () => {
      _step = 2; renderStep(root);
    });

    // Back
    root.querySelector("#wzBack")?.addEventListener("click", () => {
      _step--; renderStep(root);
    });

    // Next
    root.querySelector("#wzNext")?.addEventListener("click", () => {
      _step++; renderStep(root);
    });

    // Step 2: VAT option cards
    root.querySelectorAll("#optVat .wz-opt-card").forEach(card => {
      card.addEventListener("click", () => {
        root.querySelectorAll("#optVat .wz-opt-card").forEach(c => {
          c.classList.remove("selected");
          c.querySelector(".wz-opt-radio")?.classList.remove("on");
        });
        card.classList.add("selected");
        card.querySelector(".wz-opt-radio")?.classList.add("on");
        _draft.vat_mode = card.dataset.val;
      });
    });

    // Step 2: EK option cards
    root.querySelectorAll("#optEk .wz-opt-card").forEach(card => {
      card.addEventListener("click", () => {
        root.querySelectorAll("#optEk .wz-opt-card").forEach(c => {
          c.classList.remove("selected");
          c.querySelector(".wz-opt-radio")?.classList.remove("on");
        });
        card.classList.add("selected");
        card.querySelector(".wz-opt-radio")?.classList.add("on");
        _draft.ek_mode = card.dataset.val;
      });
    });

    // Step 3: mode cards
    root.querySelectorAll(".wz-mode-card").forEach(card => {
      card.addEventListener("click", () => {
        root.querySelectorAll(".wz-mode-card").forEach(c => {
          c.classList.remove("selected");
          c.querySelector(".wz-mode-check")?.classList.remove("on");
        });
        card.classList.add("selected");
        card.querySelector(".wz-mode-check")?.classList.add("on");
        _draft.flipcheck_mode = card.dataset.mode;
      });
    });

    // Step 4: finish
    root.querySelector("#wzFinish")?.addEventListener("click", () => saveAndClose(null, root));

    // Step 4: first scan
    root.querySelector("#wzScanFirst")?.addEventListener("click", async () => {
      const ean = root.querySelector("#wzFirstEan")?.value.trim();
      if (ean && /^\d{8,14}$/.test(ean)) {
        await saveAndClose(ean, root);
      } else {
        root.querySelector("#wzFirstEan")?.focus();
        if (typeof Toast !== "undefined")
          Toast.warning("Ungültige EAN", "Bitte 8–14 Ziffern eingeben.");
      }
    });

    root.querySelector("#wzFirstEan")?.addEventListener("keydown", e => {
      if (e.key === "Enter") root.querySelector("#wzScanFirst")?.click();
    });
  }

  // ── Save & close ──────────────────────────────────────────────────────────
  async function saveAndClose(firstEan, root) {
    try {
      await Storage.saveSettings({
        onboarding_done: true,
        language: I18N.getLang(),
        tax: {
          vat_mode: _draft.vat_mode,
          ek_mode:  _draft.ek_mode,
        },
        defaults: {
          market:         "ebay",
          flipcheck_mode: _draft.flipcheck_mode,
          ek_mode:        _draft.ek_mode,
        },
      });
    } catch (e) {
      console.error("[Onboarding] saveSettings failed:", e);
    }
    // Apply language to DOM now that it's saved
    I18N.applyToDOM();
    root.style.display = "none";
    root.innerHTML = "";
    if (_resolve) { _resolve(firstEan || null); _resolve = null; }
  }

  return { show };
})();
