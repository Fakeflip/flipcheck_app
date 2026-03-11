/* Flipcheck Extension — Shared Constants */

const REMOTE_BASE  = 'https://gate.joinflipcheck.app';
const BRIDGE_BASE  = 'http://127.0.0.1:8766';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const STORAGE_KEYS = {
  TOKEN:     'fc_token',
  TOKEN_EXP: 'fc_token_exp',
  SETTINGS:  'fc_settings',
  RECENT:    'fc_recent',
};

const VERDICT_COLORS = {
  BUY:  { bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.35)', text: '#10B981' },
  HOLD: { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.35)', text: '#F59E0B' },
  SKIP: { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.35)',  text: '#EF4444' },
};

// eBay DE category → tiered fee rate (mirrors flipcheck.js desktop)
const CATEGORIES = [
  { id: 'computer_tablets',  label: 'Computer / Tablets',    tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'smartphones',       label: 'Smartphones',           tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'gaming',            label: 'Gaming',                tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'foto_video',        label: 'Foto & Video',          tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'tv_audio',          label: 'TV & Audio',            tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'haushalt',          label: 'Haushalt',              tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'drucker',           label: 'Drucker / Scanner',     tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'scanner_hw',        label: 'Scanner-Hardware',      tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'zubehoer',          label: 'Zubehör (allgemein)',   tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'kabel',             label: 'Kabel & Stecker',       tiers: [[990, 0.11],  [null, 0.03]] },
  // Sonstiges: 12% bis €990, danach 3% (seit Feb 2026)
  { id: 'mode',              label: 'Mode & Bekleidung',     tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'sport',             label: 'Sport & Freizeit',      tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'spielzeug',         label: 'Spielzeug',             tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'buecher',           label: 'Bücher',                tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'sonstiges',         label: 'Sonstiges',             tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'other',             label: 'Sonstige Kategorie',    tiers: [[990, 0.12], [null, 0.03]] },
];

// ── Amazon Fee Tables ─────────────────────────────────────────────────────────
// Referral fees by category (Amazon DE, 2025/2026 rates)
// Personal Computers/Tablets: 6%; Consumer Electronics/Smartphones: 8%; Min. fee €0.30
const AMAZON_REFERRAL_PCTS = {
  computer_tablets:   0.06,  // Personal Computers & Tablets: 6% (Amazon DE 2025)
  handys:             0.08,  // Smartphones: 8% (Consumer Electronics Amazon DE)
  konsolen:           0.08,
  foto_camcorder:     0.08,
  tv_video_audio:     0.08,
  haushaltsgeraete:   0.08,
  drucker:            0.08,
  handy_zubehoer:     0.15,
  notebook_zubehoer:  0.15,
  kabel:              0.15,
  mode:               0.15,
  sport_freizeit:     0.15,
  spielzeug:          0.15,
  buecher:            0.15,
  sonstiges:          0.15,
};

// FBA fee tiers (Amazon DE 2025, inkl. Deutschland-Aufschlag +€0.26/Einheit)
// [maxWeightKg, maxLongestCm, feeEur, label]
const DE_FBA_SURCHARGE = 0.26;
const FBA_TIERS = [
  [0.20,  20, 2.70 + DE_FBA_SURCHARGE, 'Klein Standard'],
  [0.40,  30, 3.00 + DE_FBA_SURCHARGE, 'Klein Standard+'],
  [0.90,  33, 3.40 + DE_FBA_SURCHARGE, 'Standard 1'],
  [1.50,  33, 3.80 + DE_FBA_SURCHARGE, 'Standard 2'],
  [3.00,  45, 4.70 + DE_FBA_SURCHARGE, 'Groß 1'],
  [5.00,  61, 5.40 + DE_FBA_SURCHARGE, 'Groß 2'],
  [9.00,  61, 6.50 + DE_FBA_SURCHARGE, 'Groß 3'],
  [15.0,  74, 8.10 + DE_FBA_SURCHARGE, 'Groß 4'],
  [null, null, 9.80 + DE_FBA_SURCHARGE, 'Schwer/Sperrig'],
];
