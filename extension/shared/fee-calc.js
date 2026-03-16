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
  // Sonstige: 12% bis €990, danach 3% (eBay DE seit Feb 2026)
  { id: 'mode',              label: 'Mode / Bekleidung',               group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'sport_freizeit',    label: 'Sport & Freizeit',                group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'spielzeug',         label: 'Spielzeug / LEGO',                group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'haushalt_garten',   label: 'Haushalt & Garten',               group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'buecher',           label: 'Bücher & Medien',                 group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
  { id: 'sonstiges',         label: 'Sonstiges',                       group: 'Sonstiges (12%+3%)',  tiers: [[990, 0.12], [null, 0.03]] },
];

// eBay DE fixed per-order fee (since Feb 12, 2026): €0.35 for orders ≤€10, €0.45 for orders >€10
function _fcFixedFee(priceGross) {
  return priceGross > 10 ? 0.45 : 0.35;
}

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
  return fee + _fcFixedFee(priceGross);
}

/**
 * Full frontend profit calculator (mirrors backend logic).
 * @param {number} vkGross  - Selling price gross (€)
 * @param {number} ekGross  - Purchase price (€, gross or net based on ekMode)
 * @param {string} catId    - eBay category ID
 * @param {string} vatMode  - 'no_vat' | 'ust_19'
 * @param {string} ekMode   - 'gross' | 'net'
 * @param {number} shipIn   - Inbound shipping cost (€)
 * @param {number} shipOut  - Outbound shipping cost (€)
 * @returns {{ feeGross, feeNet, vkNet, ekNet, profit, margin }}
 */
function fcCalcProfit(vkGross, ekGross, catId, vatMode = 'no_vat', ekMode = 'gross', shipIn = 0, shipOut = 0, adRatePct = 0) {
  const vat    = vatMode === 'ust_19' ? 1.19 : 1.0;
  const feeGross = fcCalcEbayFee(vkGross, catId);
  const feeNet   = feeGross / vat;
  const vkNet    = vkGross / vat;
  const ekNet    = (vatMode === 'ust_19' && ekMode === 'gross') ? ekGross / vat : ekGross;
  const adFeeGross = vkGross * ((adRatePct || 0) / 100);
  const adFeeNet   = adFeeGross / vat;
  const profit   = vkNet - feeNet - ekNet - (shipIn || 0) - (shipOut || 0) - adFeeNet;
  const margin   = vkGross > 0 ? (profit / vkGross * 100) : 0;
  return { feeGross, feeNet, vkNet, ekNet, adFeeGross, adFeeNet, profit, margin };
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

// ── Amazon Fee Calculator (Revenue Calculator Style) ──────────────────────────

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
 * Full Amazon profit calculator — mirrors Amazon Revenue Calculator.
 *
 * Fee components:
 * 1. Referral Fee  — % of sell price (category-dependent), min €0.30
 * 2. FBA Fee       — weight/size-based fulfillment fee (or from API)
 * 3. Closing Fee   — €1.01 for media categories (Bücher, DVD, Musik, Software, Games)
 * 4. Storage Fee   — monthly per-unit rate × months (optional)
 * 5. Prep Fee      — optional prep/labeling cost per unit
 *
 * Profit = sellPrice - referralFee - fbaFee - closingFee - storageFee - prepFee - shipIn - ek
 *
 * When vatMode is "ust_19", all values are converted to net (÷1.19).
 *
 * @param {object} p
 * @param {number} p.sellPrice       - Amazon sell price (Buy Box, gross)
 * @param {number} p.ek              - Purchase price
 * @param {string} [p.category]      - Category ID for referral fee lookup
 * @param {string} [p.method]        - "fba" or "fbm"
 * @param {number} [p.shipIn]        - Inbound shipping / FBM outbound cost
 * @param {number} [p.fbaFee]        - FBA fulfillment fee (from API or null to auto-calc)
 * @param {number} [p.weightKg]      - Product weight in kg (for tier calc)
 * @param {number} [p.longestCm]     - Longest side in cm (for tier calc)
 * @param {number} [p.prepFee]       - Prep/labeling fee per unit
 * @param {number} [p.storageMon]    - Months of FBA storage
 * @param {string} [p.sizeCat]       - Size category for storage ("klein"|"standard"|"uebergross")
 * @param {string} [p.vatMode]       - "no_vat" | "ust_19"
 * @param {string} [p.ekMode]        - "gross" | "net"
 * @returns {object} Full fee breakdown
 */
function fcCalcAmazonProfit({
  sellPrice, ek,
  category = 'sonstiges', method = 'fba',
  shipIn = 0, fbaFee = null,
  weightKg = 0.5, longestCm = 20,
  prepFee = 0, storageMon = 0, sizeCat = 'standard',
  vatMode = 'no_vat', ekMode = 'gross',
}) {
  const vat = vatMode === 'ust_19' ? 1.19 : 1.0;

  // 1. Referral Fee (% of gross sell price, min €0.30)
  const refPct = (typeof AMAZON_REFERRAL_PCTS !== 'undefined' ? AMAZON_REFERRAL_PCTS[category] : null) || 0.15;
  const referralFeeGross = +Math.max(0.30, sellPrice * refPct).toFixed(2);

  // 2. FBA Fee — use API value if provided, otherwise calculate from weight/size
  let fbaFeeGross = 0;
  let fbaTierLabel = '';
  if (method === 'fba') {
    if (fbaFee != null && fbaFee > 0) {
      fbaFeeGross = fbaFee;
      // Reverse-lookup tier label
      const t = fcGetFbaTier(weightKg, longestCm);
      fbaTierLabel = t.label;
    } else {
      const t = fcGetFbaTier(weightKg, longestCm);
      fbaFeeGross = t.fee;
      fbaTierLabel = t.label;
    }
  }

  // 3. Closing Fee — media categories only
  const closingCats = typeof AMAZON_CLOSING_CATS !== 'undefined' ? AMAZON_CLOSING_CATS : ['buecher'];
  const closingFeeAmt = typeof AMAZON_CLOSING_FEE !== 'undefined' ? AMAZON_CLOSING_FEE : 1.01;
  const closingFee = closingCats.includes(category) ? closingFeeAmt : 0;

  // 4. Storage Fee
  let storageFee = 0;
  if (storageMon > 0 && method === 'fba') {
    const rates = typeof FBA_STORAGE_RATES !== 'undefined' ? FBA_STORAGE_RATES : { standard: { normal: 0.51, q4: 1.21 } };
    const isQ4 = new Date().getMonth() >= 9;
    const catRates = rates[sizeCat] || rates.standard;
    storageFee = +(catRates[isQ4 ? 'q4' : 'normal'] * storageMon).toFixed(2);
  }

  // 5. FBM: no FBA fee, but ship_in is outbound shipping
  const shipOut = method === 'fbm' ? shipIn : 0;
  const shipInCost = method === 'fba' ? shipIn : 0;

  // Netto conversion
  const sellNet      = +(sellPrice / vat).toFixed(2);
  const referralNet  = +(referralFeeGross / vat).toFixed(2);
  const fbaNet       = +(fbaFeeGross / vat).toFixed(2);
  const closingNet   = +(closingFee / vat).toFixed(2);
  const storageNet   = +(storageFee / vat).toFixed(2);
  const prepNet      = +(prepFee / vat).toFixed(2);
  const shipInNet    = +(shipInCost / vat).toFixed(2);
  const shipOutNet   = +(shipOut / vat).toFixed(2);
  const ekNet        = (vatMode === 'ust_19' && ekMode === 'gross') ? +(ek / vat).toFixed(2) : ek;

  const totalFees    = +(referralNet + fbaNet + closingNet + storageNet + prepNet + shipInNet + shipOutNet).toFixed(2);
  const profit       = +(sellNet - totalFees - ekNet).toFixed(2);
  const marginPct    = sellPrice > 0 ? +((profit / sellNet) * 100).toFixed(1) : 0;
  const roiPct       = ekNet > 0 ? +((profit / ekNet) * 100).toFixed(1) : 0;

  return {
    // Gross values (for display)
    referralFeeGross, fbaFeeGross, closingFee, storageFee, prepFee: prepFee,
    // Net values (for calculation)
    sellNet, referralFee: referralNet, fbaFee: fbaNet, closingFeeNet: closingNet,
    storageFeeNet: storageNet, prepFeeNet: prepNet, shipInNet, shipOutNet, ekNet,
    totalFees, profit, marginPct, roiPct,
    // Meta
    referralPct: +(refPct * 100).toFixed(1),
    fbaTierLabel,
    method,
  };
}
