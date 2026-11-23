const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { parseAddressPin } = require('../orders/order_flow');

// ─────────────────────────────────────────────────────────────────────────────
//  Delivery fee engine — distance (km) + weight (kg) + material based pricing.
//  Rates are admin-configurable and stored in delivery_fee_settings (1 row).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  baseFeeCents: 2000,        // 20 ETB starting fee (covers pickup + free km)
  freeKm: 2,                 // km included in the base fee
  perKmCents: 1200,          // 12 ETB per km beyond freeKm
  freeWeightGrams: 2000,     // 2 kg included free
  perKgCents: 1500,          // 15 ETB per kg beyond free weight
  fragileSurchargeCents: 3000, // +30 ETB per fragile item
  bulkyMultiplier: 1.5,      // fragile→surcharge; bulky→multiplies subtotal
  defaultKm: 8,              // assumed distance when location can't be resolved
  roadFactor: 1.25,          // straight-line → road distance approximation
  minFeeCents: 2000,         // never below the base fee
  maxFeeCents: 15000,        // hard cap 150 ETB
  // Platform commission settings
  serviceFeeCents: 2000,     // flat service fee charged to the customer (first shop leg)
  serviceFeeExtraLegPct: 50, // % of serviceFeeCents charged per additional shop leg
  partnerCommissionPct: 1.0, // % of product subtotal deducted from partner
  riderCommissionPct: 15.0,  // % of delivery fee deducted from rider
};

let schemaPromise = null;
function ensureFeeSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_fee_cents INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_commission_cents INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_commission_cents INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS commission_cents INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE delivery_fee_settings ADD COLUMN IF NOT EXISTS service_fee_cents INTEGER NOT NULL DEFAULT 2000`);
      await pool.query(`ALTER TABLE delivery_fee_settings ADD COLUMN IF NOT EXISTS service_fee_extra_leg_pct DOUBLE PRECISION NOT NULL DEFAULT 50`);
      await pool.query(`ALTER TABLE delivery_fee_settings ADD COLUMN IF NOT EXISTS partner_commission_pct DOUBLE PRECISION NOT NULL DEFAULT 1.0`);
      await pool.query(`ALTER TABLE delivery_fee_settings ADD COLUMN IF NOT EXISTS rider_commission_pct DOUBLE PRECISION NOT NULL DEFAULT 15.0`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS delivery_fee_settings (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          base_fee_cents INTEGER NOT NULL DEFAULT 2000,
          free_km DOUBLE PRECISION NOT NULL DEFAULT 2,
          per_km_cents INTEGER NOT NULL DEFAULT 1200,
          free_weight_grams INTEGER NOT NULL DEFAULT 2000,
          per_kg_cents INTEGER NOT NULL DEFAULT 1500,
          fragile_surcharge_cents INTEGER NOT NULL DEFAULT 3000,
          bulky_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.5,
          default_km DOUBLE PRECISION NOT NULL DEFAULT 8,
          road_factor DOUBLE PRECISION NOT NULL DEFAULT 1.25,
          min_fee_cents INTEGER NOT NULL DEFAULT 2000,
          max_fee_cents INTEGER NOT NULL DEFAULT 15000,
          service_fee_cents INTEGER NOT NULL DEFAULT 2000,
          service_fee_extra_leg_pct DOUBLE PRECISION NOT NULL DEFAULT 50,
          partner_commission_pct DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          rider_commission_pct DOUBLE PRECISION NOT NULL DEFAULT 15.0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(
        `INSERT INTO delivery_fee_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function getSettings() {
  await ensureFeeSchema();
  const { rows } = await pool.query(`SELECT * FROM delivery_fee_settings WHERE id = 1`);
  const r = rows[0] || {};
  return {
    baseFeeCents: r.base_fee_cents ?? DEFAULT_SETTINGS.baseFeeCents,
    freeKm: Number(r.free_km ?? DEFAULT_SETTINGS.freeKm),
    perKmCents: r.per_km_cents ?? DEFAULT_SETTINGS.perKmCents,
    freeWeightGrams: r.free_weight_grams ?? DEFAULT_SETTINGS.freeWeightGrams,
    perKgCents: r.per_kg_cents ?? DEFAULT_SETTINGS.perKgCents,
    fragileSurchargeCents: r.fragile_surcharge_cents ?? DEFAULT_SETTINGS.fragileSurchargeCents,
    bulkyMultiplier: Number(r.bulky_multiplier ?? DEFAULT_SETTINGS.bulkyMultiplier),
    defaultKm: Number(r.default_km ?? DEFAULT_SETTINGS.defaultKm),
    roadFactor: Number(r.road_factor ?? DEFAULT_SETTINGS.roadFactor),
    minFeeCents: r.min_fee_cents ?? DEFAULT_SETTINGS.minFeeCents,
    maxFeeCents: r.max_fee_cents ?? DEFAULT_SETTINGS.maxFeeCents,
    serviceFeeCents: r.service_fee_cents ?? DEFAULT_SETTINGS.serviceFeeCents,
    serviceFeeExtraLegPct: Number(r.service_fee_extra_leg_pct ?? DEFAULT_SETTINGS.serviceFeeExtraLegPct),
    partnerCommissionPct: Number(r.partner_commission_pct ?? DEFAULT_SETTINGS.partnerCommissionPct),
    riderCommissionPct: Number(r.rider_commission_pct ?? DEFAULT_SETTINGS.riderCommissionPct),
  };
}

const SETTING_FIELDS = {
  baseFeeCents: 'base_fee_cents',
  freeKm: 'free_km',
  perKmCents: 'per_km_cents',
  freeWeightGrams: 'free_weight_grams',
  perKgCents: 'per_kg_cents',
  fragileSurchargeCents: 'fragile_surcharge_cents',
  bulkyMultiplier: 'bulky_multiplier',
  defaultKm: 'default_km',
  roadFactor: 'road_factor',
  minFeeCents: 'min_fee_cents',
  maxFeeCents: 'max_fee_cents',
  serviceFeeCents: 'service_fee_cents',
  serviceFeeExtraLegPct: 'service_fee_extra_leg_pct',
  partnerCommissionPct: 'partner_commission_pct',
  riderCommissionPct: 'rider_commission_pct',
};

async function updateSettings(body = {}) {
  await ensureFeeSchema();
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(SETTING_FIELDS)) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < 0) {
        throw new AppError(`Invalid value for ${key}`, 400, 'INVALID_SETTING');
      }
      params.push(n);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length > 0) {
    params.push(1);
    await pool.query(
      `UPDATE delivery_fee_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params,
    );
  }
  return getSettings();
}

// ── Addis Ababa zones: keyword → centroid coords (for address-text distance) ──
const ZONES = [
  { keys: ['bole', 'bulbula'], lat: 8.995, lng: 38.785 },
  { keys: ['kazanchis', 'station'], lat: 9.019, lng: 38.769 },
  { keys: ['piassa'], lat: 9.034, lng: 38.752 },
  { keys: ['merkato', 'market'], lat: 9.030, lng: 38.730 },
  { keys: ['sarbet', 'mexico'], lat: 9.001, lng: 38.735 },
  { keys: ['yeka'], lat: 9.052, lng: 38.752 },
  { keys: ['kirkos'], lat: 9.022, lng: 38.742 },
  { keys: ['arada'], lat: 9.036, lng: 38.756 },
  { keys: ['lideta'], lat: 9.030, lng: 38.746 },
  { keys: ['nifas', 'silk'], lat: 8.990, lng: 38.800 },
  { keys: ['kolfe'], lat: 9.062, lng: 38.782 },
  { keys: ['akaki', 'kality'], lat: 8.980, lng: 38.790 },
  { keys: ['gulele'], lat: 9.042, lng: 38.768 },
  { keys: ['addis ketema', 'ketema'], lat: 9.032, lng: 38.748 },
  { keys: ['lemi'], lat: 8.980, lng: 38.720 },
  { keys: ['cmc', 'friendship'], lat: 9.020, lng: 38.800 },
  { keys: ['gotera'], lat: 9.052, lng: 38.792 },
  { keys: ['summit'], lat: 9.072, lng: 38.802 },
  { keys: ['old airport'], lat: 8.990, lng: 38.800 },
  { keys: ['gerji'], lat: 9.022, lng: 38.790 },
  { keys: ['megenagna'], lat: 9.032, lng: 38.792 },
  { keys: ['bole medhanealem', 'medhanealem'], lat: 9.008, lng: 38.792 },
  { keys: ['jemo'], lat: 8.952, lng: 38.780 },
  { keys: ['kore'], lat: 8.932, lng: 38.772 },
  { keys: ['lafto'], lat: 8.985, lng: 38.810 },
  { keys: ['kality'], lat: 8.972, lng: 38.792 },
  { keys: ['gedamfits', 'gedamfits total'], lat: 9.010, lng: 38.760 },
  { keys: ['sidist kilo'], lat: 9.040, lng: 38.760 },
  { keys: ['pandora'], lat: 9.045, lng: 38.775 },
  { keys: ['wollo sefer', 'sefer'], lat: 9.025, lng: 38.760 },
];

function zoneLookup(address) {
  const text = String(address || '').toLowerCase();
  if (!text) return null;
  for (const z of ZONES) {
    if (z.keys.some((k) => text.includes(k))) return z;
  }
  return null;
}

// ── Weight / material estimation from product names ──────────────────────────
const FRAGILE_KEYS = [
  'phone', 'mobile', 'laptop', 'notebook', 'watch', 'glass', 'camera',
  'headphone', 'earphone', 'earbud', 'screen', 'monitor', 'tv', 'television',
  'fragile', 'ceramic', 'mirror', 'perfume', 'cosmetic',
];
const BULKY_KEYS = [
  'fridge', 'refrigerator', 'freezer', 'bed', 'mattress', 'sofa', 'couch',
  'wardrobe', 'furniture', 'dining table', 'tv stand', 'washing machine',
  'dishwasher', 'air conditioner', 'ac unit',
];
const HEAVY_KEYS = ['tv', 'television', 'washing machine', 'fridge', 'refrigerator', 'freezer'];

function estimateItem(name) {
  const n = String(name || '').toLowerCase();
  let grams = 1000; // default ~1 kg per unit
  for (const [key, g] of [
    ['phone', 300], ['mobile', 300], ['watch', 100], ['headphone', 150],
    ['earphone', 100], ['earbud', 80], ['laptop', 2000], ['notebook', 2000],
    ['camera', 600], ['glass', 800], ['perfume', 500], ['cosmetic', 400],
    ['tv', 15000], ['television', 15000], ['monitor', 5000],
    ['fridge', 40000], ['refrigerator', 40000], ['freezer', 35000],
    ['bed', 25000], ['mattress', 20000], ['sofa', 15000], ['couch', 15000],
    ['wardrobe', 30000], ['furniture', 20000], ['washing machine', 60000],
    ['dishwasher', 50000], ['air conditioner', 25000],
  ]) {
    if (n.includes(key)) { grams = g; break; }
  }
  const fragile = FRAGILE_KEYS.some((k) => n.includes(k));
  const bulky = BULKY_KEYS.some((k) => n.includes(k)) || HEAVY_KEYS.some((k) => n.includes(k));
  return { grams, fragile, bulky };
}

// ── Geometry ─────────────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Resolve customer coords: exact pin first, then zone keyword match. */
function resolveDropoff(address) {
  const pin = parseAddressPin(address);
  if (pin.lat != null && pin.lng != null) return pin;
  const z = zoneLookup(address);
  return z ? { lat: z.lat, lng: z.lng, estimated: true } : null;
}

/**
 * Compute the delivery fee for one shop → customer leg.
 * items: [{ name, quantity }]
 * shop: { lat, lng } may be null → defaultKm fallback.
 * Returns { feeCents, breakdown }.
 */
async function computeLegFee({ items = [], shippingAddress, shopLat = null, shopLng = null }) {
  const s = await getSettings();

  // Distance
  let km = s.defaultKm;
  let distanceSource = 'default';
  const drop = resolveDropoff(shippingAddress);
  if (drop && shopLat != null && shopLng != null) {
    km = haversineKm(shopLat, shopLng, drop.lat, drop.lng) * s.roadFactor;
    distanceSource = drop.estimated ? 'zone-estimate' : 'pin';
  } else if (drop && (shopLat == null || shopLng == null)) {
    distanceSource = 'zone-no-shop-pin';
  }
  const billableKm = Math.max(0, km - s.freeKm);
  const distanceFeeCents = Math.round(billableKm * s.perKmCents);

  // Weight + material
  let totalGrams = 0;
  let fragileCount = 0;
  let hasBulky = false;
  for (const it of items) {
    const est = estimateItem(it.name);
    const qty = Math.max(1, Number(it.quantity) || 1);
    totalGrams += est.grams * qty;
    if (est.fragile) fragileCount += qty;
    if (est.bulky) hasBulky = true;
  }
  const billableKg = Math.max(0, totalGrams / 1000 - s.freeWeightGrams / 1000);
  const weightFeeCents = Math.round(billableKg * s.perKgCents);
  const fragileFeeCents = fragileCount * s.fragileSurchargeCents;

  let feeCents = s.baseFeeCents + distanceFeeCents + weightFeeCents + fragileFeeCents;
  if (hasBulky) feeCents = Math.round(feeCents * s.bulkyMultiplier);
  feeCents = Math.min(s.maxFeeCents, Math.max(s.minFeeCents, feeCents));

  return {
    feeCents,
    breakdown: {
      baseFeeCents: s.baseFeeCents,
      distanceKm: Math.round(km * 10) / 10,
      distanceSource,
      billableKm: Math.round(billableKm * 10) / 10,
      distanceFeeCents,
      weightGrams: totalGrams,
      billableKg: Math.round(billableKg * 10) / 10,
      weightFeeCents,
      fragileItems: fragileCount,
      fragileFeeCents,
      bulky: hasBulky,
      bulkyMultiplier: hasBulky ? s.bulkyMultiplier : 1,
    },
  };
}

/**
 * Total delivery fee for a whole order. Items are grouped by shop partner —
 * each partner's location prices its own leg to the customer.
 * items: [{ name, quantity, partnerId }]
 */
async function computeOrderFee({ items = [], shippingAddress }) {
  const byPartner = new Map();
  for (const it of items) {
    const pid = it.partnerId || it.partner_id || 'unknown';
    if (!byPartner.has(pid)) byPartner.set(pid, []);
    byPartner.get(pid).push(it);
  }

  let totalFeeCents = 0;
  const legs = [];
  for (const [partnerId, legItems] of byPartner) {
    let shopLat = null;
    let shopLng = null;
    if (partnerId !== 'unknown') {
      const { rows } = await pool.query(
        `SELECT shop_lat, shop_lng FROM partner_profile WHERE user_id = $1 LIMIT 1`,
        [partnerId],
      );
      shopLat = rows[0]?.shop_lat ?? null;
      shopLng = rows[0]?.shop_lng ?? null;
    }
    const leg = await computeLegFee({ items: legItems, shippingAddress, shopLat, shopLng });
    totalFeeCents += leg.feeCents;
    let shopName = null;
    let shopAddress = null;
    if (partnerId !== 'unknown') {
      const { rows: shopRows } = await pool.query(
        `SELECT COALESCE(shop_name, business_name) AS shop_name,
                COALESCE(address, city) AS shop_address
         FROM partner_profile WHERE user_id = $1 LIMIT 1`,
        [partnerId],
      );
      shopName = shopRows[0]?.shop_name ?? null;
      shopAddress = shopRows[0]?.shop_address ?? null;
    }
    legs.push({
      partnerId, shopName, shopAddress,
      shopLat, shopLng, ...leg,
    });
  }
  return { feeCents: totalFeeCents, legs };
}

/**
 * Customer service fee for an order: full fee for the first shop leg,
 * discounted fee for each additional partner location.
 */
function serviceFeeForLegs(settings, legsCount) {
  const legs = Math.max(1, legsCount || 1);
  const extra = legs - 1;
  return settings.serviceFeeCents +
    Math.round((settings.serviceFeeCents * settings.serviceFeeExtraLegPct * extra) / 100);
}

/** Resolve product names/partner for fee preview or order creation. */
async function resolveItemsForFee(rawItems) {
  // rawItems: [{ productId|product_id, quantity, name? }]
  const out = [];
  for (const it of rawItems || []) {
    const pid = it.productId || it.product_id;
    const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
    if (pid) {
      const { rows } = await pool.query(
        `SELECT id, name_en, partner_id FROM products WHERE id = $1`,
        [pid],
      );
      if (rows[0]) {
        out.push({ name: rows[0].name_en || 'Product', quantity: qty, partnerId: rows[0].partner_id });
        continue;
      }
    }
    if (it.name) out.push({ name: it.name, quantity: qty, partnerId: it.partnerId || null });
  }
  return out;
}

/**
 * Platform commission split for one order.
 * productCents: coupon-discounted product subtotal (what partners sell for).
 * deliveryFeeCents: computed delivery fee.
 * Returns the customer service fee plus per-party commission amounts.
 */
async function computeCommissions({ productCents = 0, deliveryFeeCents = 0, legsCount = 1 }) {
  const s = await getSettings();
  const serviceFeeCents = serviceFeeForLegs(s, legsCount);
  const partnerCommissionCents = Math.round((productCents * s.partnerCommissionPct) / 100);
  const riderCommissionCents = Math.round((deliveryFeeCents * s.riderCommissionPct) / 100);
  return { serviceFeeCents, partnerCommissionCents, riderCommissionCents };
}

module.exports = {
  ensureFeeSchema,
  getSettings,
  updateSettings,
  computeLegFee,
  computeOrderFee,
  computeCommissions,
  serviceFeeForLegs,
  resolveItemsForFee,
};
