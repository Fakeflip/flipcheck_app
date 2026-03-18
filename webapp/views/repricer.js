// @ts-check
/* Flipcheck Web Dashboard — Repricer (Desktop-Feature, Web-Preview) */
"use strict";

const RepricerView = (() => {
  function mount(el) {
    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Auto-Repricer</h1>
          <p>Automatische Preisoptimierung für deine eBay-Listings</p>
        </div>
      </div>
      <div class="desktop-only-card">
        <div class="desktop-only-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12h6l2-7 2 14 2-7h6"/>
          </svg>
        </div>
        <h2 class="desktop-only-title">Desktop-Feature</h2>
        <p class="desktop-only-desc">
          Der Auto-Repricer passt deine eBay-Preise automatisch an, um immer konkurrenzfähig zu bleiben.
          Dieses Feature benötigt die Desktop-App mit verbundenem eBay-Seller-Account.
        </p>
        <div class="desktop-only-features">
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">🎯</span>
            <div>
              <strong>7 Strategien</strong>
              <span>Günstigster, Rang 2/3, Top 3/5 Ø, 30-Tage Ø/Median</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">🛡️</span>
            <div>
              <strong>Floor-Preis</strong>
              <span>Mindestmarge garantiert — nie unter deinem Limit</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">📊</span>
            <div>
              <strong>Live-Status</strong>
              <span>UPDATED, RAISED, AT_FLOOR, HOLD — alles im Blick</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">⏱️</span>
            <div>
              <strong>Automatisch</strong>
              <span>Läuft im Hintergrund, kein manuelles Eingreifen nötig</span>
            </div>
          </div>
        </div>
        <a href="/dashboard" class="btn btn-primary" style="margin-top:24px;text-decoration:none">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 12v2h10v-2M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Desktop-App herunterladen
        </a>
      </div>
    `;
  }
  function unmount() {}
  return { mount, unmount };
})();
