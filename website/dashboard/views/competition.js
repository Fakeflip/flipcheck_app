// @ts-check
/* Flipcheck Web Dashboard — Konkurrenz-Monitor (Desktop-Feature, Web-Preview) */
"use strict";

const CompetitionView = (() => {
  function mount(el) {
    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Konkurrenz-Monitor</h1>
          <p>Beobachte Konkurrenten und erhalte Alerts bei Preisänderungen</p>
        </div>
      </div>
      <div class="desktop-only-card">
        <div class="desktop-only-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="9" r="5"/><circle cx="17" cy="9" r="4"/>
            <path d="M2 21c0-4 3-6 7-6s7 2 7 6"/>
          </svg>
        </div>
        <h2 class="desktop-only-title">Desktop-Feature</h2>
        <p class="desktop-only-desc">
          Überwache eBay-Verkäufer, tracke deren Listings und erhalte Discord-Webhook-Benachrichtigungen
          bei Preisänderungen, Unterbietungen und neuen Angeboten.
        </p>
        <div class="desktop-only-features">
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">👤</span>
            <div>
              <strong>Seller-Tracking</strong>
              <span>Beobachte beliebige eBay-Verkäufer und deren Inventar</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">📉</span>
            <div>
              <strong>Preisverlauf</strong>
              <span>Historische Preisänderungen als Chart je Listing</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">🔔</span>
            <div>
              <strong>Webhook-Alerts</strong>
              <span>Unterbietung, neue Listings, Preisdrops, Verdikt-Wechsel</span>
            </div>
          </div>
          <div class="desktop-only-feat">
            <span class="desktop-only-feat-icon">📦</span>
            <div>
              <strong>Inventar-Check</strong>
              <span>Eigene Produkte mit Konkurrenz-Listings abgleichen</span>
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
