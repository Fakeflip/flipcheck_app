/* Flipcheck Extension — Shared Constants */

const REMOTE_BASE  = 'https://api.joinflipcheck.app';
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
  { id: 'mode',              label: 'Mode & Bekleidung',     tiers: [[null, 0.15]] },
  { id: 'sport',             label: 'Sport & Freizeit',      tiers: [[null, 0.115]] },
  { id: 'spielzeug',         label: 'Spielzeug',             tiers: [[null, 0.115]] },
  { id: 'buecher',           label: 'Bücher',                tiers: [[null, 0.15]] },
  { id: 'sonstiges',         label: 'Sonstiges',             tiers: [[null, 0.13]] },
  { id: 'other',             label: 'Sonstige Kategorie',    tiers: [[null, 0.13]] },
];

// ── Amazon Fee Tables ─────────────────────────────────────────────────────────
// Referral fees by category (Amazon DE, approximate)
const AMAZON_REFERRAL_PCTS = {
  computer_tablets:   0.07,
  handys:             0.07,
  konsolen:           0.08,
  foto_camcorder:     0.07,
  tv_video_audio:     0.07,
  haushaltsgeraete:   0.07,
  drucker:            0.07,
  handy_zubehoer:     0.15,
  notebook_zubehoer:  0.15,
  kabel:              0.15,
  mode:               0.15,
  sport_freizeit:     0.15,
  spielzeug:          0.15,
  buecher:            0.15,
  sonstiges:          0.15,
};

// FBA fee tiers (simplified DE 2024)
// [maxWeightKg, maxLongestCm, feeEur, label]
const FBA_TIERS = [
  [0.20,  20, 2.70, 'Klein Standard'],
  [0.40,  30, 3.00, 'Klein Standard+'],
  [0.90,  33, 3.40, 'Standard 1'],
  [1.50,  33, 3.80, 'Standard 2'],
  [3.00,  45, 4.70, 'Groß 1'],
  [5.00,  61, 5.40, 'Groß 2'],
  [9.00,  61, 6.50, 'Groß 3'],
  [15.0,  74, 8.10, 'Groß 4'],
  [null, null, 9.80, 'Schwer/Sperrig'],
];
