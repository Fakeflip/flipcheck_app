/* Flipcheck Extension — Fee & Profit Calculator
 * Ported from v2/assets/views/flipcheck.js (mirrors backend _calc_tiered_fee)
 */

// Full category list with tiered fee rates (eBay DE, without Shop)
const FC_CATEGORIES = [
  // Geräte: 6,5% bis €990, danach 3%
  { id: 'computer_tablets',  label: 'Computer, Tablets & Netzwerk',   group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'drucker',           label: 'Drucker',                         group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'foto_camcorder',    label: 'Foto & Camcorder',                group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'handys',            label: 'Handys & Kommunikation',          group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'haushaltsgeraete',  label: 'Haushaltsgeräte',                 group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'konsolen',          label: 'Konsolen / Videospiele',          group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'scanner',           label: 'Scanner',                         group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'speicherkarten',    label: 'Speicherkarten',                  group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'tv_video_audio',    label: 'TV, Video & Audio',               group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  { id: 'koerperpflege',     label: 'Elektr. Körperpflege',            group: 'Geräte (6,5%+3%)',   tiers: [[990, 0.065], [null, 0.03]] },
  // Zubehör: 11% bis €990, danach 3%
  { id: 'drucker_zubehoer',  label: 'Drucker- & Scanner-Zubehör',     group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'handy_zubehoer',    label: 'Handy-Zubehör',                   group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'batterien',         label: 'Batterien & Strom',               group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'kabel',             label: 'Kabel & Steckverbinder',          group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'notebook_zubehoer', label: 'Notebook- & Desktop-Zubehör',    group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'tablet_zubehoer',   label: 'Tablet & eBook Zubehör',         group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: 'pc_zubehoer',       label: 'PC & Videospiele Zubehör',       group: 'Zubehör (11%+3%)',    tiers: [[990, 0.11],  [null, 0.03]] },
  // Sonstige Flat-Rate
  { id: 'mode',              label: 'Mode / Bekleidung',               group: 'Sonstiges (Flat)',    tiers: [[null, 0.15]]  },
  { id: 'sport_freizeit',    label: 'Sport & Freizeit',                group: 'Sonstiges (Flat)',    tiers: [[null, 0.115]] },
  { id: 'spielzeug',         label: 'Spielzeug / LEGO',                group: 'Sonstiges (Flat)',    tiers: [[null, 0.115]] },
  { id: 'haushalt_garten',   label: 'Haushalt & Garten',               group: 'Sonstiges (Flat)',    tiers: [[null, 0.115]] },
  { id: 'buecher',           label: 'Bücher & Medien',                 group: 'Sonstiges (Flat)',    tiers: [[null, 0.15]]  },
  { id: 'sonstiges',         label: 'Sonstiges',                       group: 'Sonstiges (Flat)',    tiers: [[null, 0.13]]  },
];

function fcCalcEbayFee(priceGross, catId) {
  const cat = FC_CATEGORIES.find(c => c.id === catId) || FC_CATEGORIES[FC_CATEGORIES.length - 1];
  let fee = 0, remaining = Math.max(0, priceGross), prev = 0;
  for (const [threshold, rate] of cat.tiers) {
    if (threshold === null) { fee += remaining * rate; break; }
    const chunk = Math.min(remaining, threshold - prev);
    fee += chunk * rate;
    remaining -= chunk;
    prev = threshold;
    if (remaining <= 0) break;
  }
  return fee;
}

/**
 * Full frontend profit calculator (mirrors backend logic).
 * @param {number} vkGross  - Selling price gross (€)
 * @param {number} ekGross  - Purchase price (€, gross or net based on ekMode)
 * @param {string} catId    - eBay category ID
 * @param {string} vatMode  - 'no_vat' | 'ust_19'
 * @param {string} ekMode   - 'gross' | 'net'
 * @returns {{ feeGross, feeNet, vkNet, ekNet, profit, margin }}
 */
function fcCalcProfit(vkGross, ekGross, catId, vatMode = 'no_vat', ekMode = 'gross') {
  const vat    = vatMode === 'ust_19' ? 1.19 : 1.0;
  const feeGross = fcCalcEbayFee(vkGross, catId);
  const feeNet   = feeGross / vat;
  const vkNet    = vkGross / vat;
  const ekNet    = (vatMode === 'ust_19' && ekMode === 'gross') ? ekGross / vat : ekGross;
  const profit   = vkNet - feeNet - ekNet;
  const margin   = vkGross > 0 ? (profit / vkGross * 100) : 0;
  return { feeGross, feeNet, vkNet, ekNet, profit, margin };
}

function fcBuildCatOptions(selectedId) {
  const groups = {};
  for (const c of FC_CATEGORIES) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  }
  return Object.entries(groups).map(([grp, cats]) =>
    `<optgroup label="${grp}">${
      cats.map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${c.label}</option>`).join('')
    }</optgroup>`
  ).join('');
}

// ── Amazon Fee Calculator ─────────────────────────────────────────────────────

/**
 * Get FBA fee for given weight/dimensions.
 * @param {number} weightKg
 * @param {number} longestCm
 * @returns {{ fee: number, label: string }}
 */
function fcGetFbaTier(weightKg = 0.5, longestCm = 20) {
  for (const [maxW, maxSide, fee, label] of (typeof FBA_TIERS !== 'undefined' ? FBA_TIERS : [])) {
    if (maxW === null) return { fee, label };
    if (weightKg <= maxW && longestCm <= maxSide) return { fee, label };
  }
  return { fee: 9.80, label: 'Schwer/Sperrig' };
}

/**
 * Calculate Amazon profit.
 * @param {object} p
 * @param {number} p.sellPrice    - Amazon sell price (Buy Box or similar)
 * @param {number} p.ek           - Purchase price (EK)
 * @param {string} p.category     - Category ID for referral fee lookup
 * @param {string} p.method       - "fba" or "fbm"
 * @param {number} p.shipIn       - Inbound shipping cost
 * @param {number} p.fbaFee       - FBA fulfillment fee (from API or tier)
 * @returns {{ referralFee, fbaFee, totalFees, profit, marginPct }}
 */
function fcCalcAmazonProfit({ sellPrice, ek, category = 'sonstiges', method = 'fba', shipIn = 4.99, fbaFee = 3.40 }) {
  const refPct     = (typeof AMAZON_REFERRAL_PCTS !== 'undefined' ? AMAZON_REFERRAL_PCTS[category] : null) || 0.15;
  const referralFee = +(sellPrice * refPct).toFixed(2);
  const fulfillment = method === 'fba' ? fbaFee : 0;
  const shipOut     = method === 'fbm' ? shipIn : 0;
  const totalFees   = +(referralFee + fulfillment + shipOut).toFixed(2);
  const profit      = +(sellPrice - totalFees - ek - shipIn).toFixed(2);
  const marginPct   = sellPrice > 0 ? +((profit / sellPrice) * 100).toFixed(1) : 0;
  return { referralFee, fbaFee: fulfillment, totalFees, profit, marginPct, referralPct: +(refPct * 100).toFixed(1) };
}
