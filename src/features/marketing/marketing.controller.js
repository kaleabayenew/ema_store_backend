const {
  getWheelConfig,
  playSpin,
  getUserCoupons,
  claimCoupon,
  getAdminWheelConfig,
  updateWheelConfig,
  getAdminCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require('./marketing.service');
const { ok, created } = require('../../core/utils/response');

// ── Customer: Get wheel config ─────────────────────────────────────────────────

async function getSpinWheel(req, res, next) {
  try {
    const config = await getWheelConfig(req.user.id);
    ok(res, config);
  } catch (e) { next(e); }
}

// ── Customer: Play spin ───────────────────────────────────────────────────────

async function playSpinWheel(req, res, next) {
  try {
    const result = await playSpin(req.user.id);
    ok(res, result);
  } catch (e) { next(e); }
}

// ── Customer: Get my coupons ───────────────────────────────────────────────────

async function getMyCoupons(req, res, next) {
  try {
    const coupons = await getUserCoupons(req.user.id);
    ok(res, { coupons });
  } catch (e) { next(e); }
}

// ── Customer: Claim coupon by code ────────────────────────────────────────────

async function claimCouponByCode(req, res, next) {
  try {
    const { code } = req.body;
    const trimmed = String(code || '').trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }
    if (trimmed.length > 50 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      return res.status(400).json({ success: false, message: 'Invalid coupon code format' });
    }
    const coupon = await claimCoupon(req.user.id, trimmed);
    res.status(201).json({ success: true, coupon });
  } catch (e) { next(e); }
}

// ── Admin: Get wheel config ───────────────────────────────────────────────────

async function getAdminWheel(req, res, next) {
  try {
    const config = await getAdminWheelConfig();
    ok(res, { slices: config });
  } catch (e) { next(e); }
}

// ── Admin: Update wheel config ────────────────────────────────────────────────

async function updateAdminWheel(req, res, next) {
  try {
    const { slices } = req.body;
    if (!Array.isArray(slices)) {
      return res.status(400).json({ success: false, message: 'Slices must be an array' });
    }
    const result = await updateWheelConfig(slices);
    ok(res, result);
  } catch (e) { next(e); }
}

// ── Customer: Preview a coupon discount for checkout ─────────────────────────

async function validateCouponPreview(req, res, next) {
  try {
    const { code, subtotalCents } = req.body || {};
    const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
    const { validateCouponForOrder } = require('./marketing.service');
    const result = await validateCouponForOrder(req.user.id, code, subtotal);
    ok(res, {
      code: result.coupon.code,
      discountType: result.coupon.discount_type,
      discountValue: parseFloat(result.coupon.discount_value),
      discountCents: result.discountCents,
      minOrderCents: result.coupon.min_order_cents,
    });
  } catch (e) { next(e); }
}

// ── Admin: Coupon CRUD ────────────────────────────────────────────────────────

const COUPON_TYPES = new Set(['PERCENT', 'FIXED']);

function cleanCouponBody(body = {}) {
  const pick = (camel, snake) => (body[camel] !== undefined ? body[camel] : body[snake]);
  const out = {};

  const code = pick('code', 'code');
  if (code !== undefined) out.code = String(code).trim().toUpperCase();

  const discountType = pick('discountType', 'discount_type');
  if (discountType !== undefined) out.discountType = String(discountType).toUpperCase();

  const discountValue = pick('discountValue', 'discount_value');
  if (discountValue !== undefined) out.discountValue = Number(discountValue);

  for (const [camel, snake, key] of [
    ['minOrderCents', 'min_order_cents', 'minOrderCents'],
    ['maxDiscountCents', 'max_discount_cents', 'maxDiscountCents'],
    ['usageLimit', 'usage_limit', 'usageLimit'],
  ]) {
    const v = pick(camel, snake);
    if (v !== undefined) out[key] = Math.max(0, Math.round(Number(v) || 0));
  }

  const expiresRaw = pick('expiresAt', 'expires_at');
  if (expiresRaw !== undefined) {
    if (expiresRaw === null || expiresRaw === '') {
      out.expiresAt = null; // explicit clear
    } else {
      const d = new Date(expiresRaw);
      out.expiresAt = Number.isNaN(d.getTime()) ? undefined : d.toISOString();
      out._expiresInvalid = out.expiresAt === undefined;
    }
  }

  const isActive = pick('isActive', 'is_active');
  if (isActive !== undefined) {
    out.isActive = isActive === true || isActive === 'true' || isActive === 1;
  }

  return out;
}

function validateCouponData(d, { partial = false } = {}) {
  if (!partial || d.code !== undefined) {
    if (!d.code || d.code.length > 50 || !/^[A-Z0-9_-]+$/.test(d.code)) {
      return 'Code must be 1-50 chars (A-Z, 0-9, _ or -).';
    }
  }
  if (!partial || d.discountType !== undefined) {
    if (!COUPON_TYPES.has(d.discountType)) return 'discountType must be PERCENT or FIXED.';
  }
  if (!partial || d.discountValue !== undefined) {
    if (!Number.isFinite(d.discountValue) || d.discountValue <= 0) return 'discountValue must be a positive number.';
    if (d.discountType === 'PERCENT' && d.discountValue > 100) return 'Percent discount cannot exceed 100.';
  }
  if (d._expiresInvalid) return 'expiresAt must be a valid date.';
  return null;
}

async function adminGetCoupons(_req, res, next) {
  try {
    const coupons = await getAdminCoupons();
    ok(res, { coupons, count: coupons.length });
  } catch (e) { next(e); }
}

async function adminCreateCoupon(req, res, next) {
  try {
    const d = cleanCouponBody(req.body || {});
    const invalid = validateCouponData(d);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const coupon = await createCoupon(d);
    created(res, { coupon });
  } catch (e) { next(e); }
}

async function adminUpdateCoupon(req, res, next) {
  try {
    const d = cleanCouponBody(req.body || {});
    const invalid = validateCouponData(d, { partial: true });
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const coupon = await updateCoupon(req.params.id, d);
    ok(res, { coupon });
  } catch (e) { next(e); }
}

async function adminDeleteCoupon(req, res, next) {
  try {
    await deleteCoupon(req.params.id);
    ok(res, { message: 'Coupon deleted' });
  } catch (e) { next(e); }
}

module.exports = {
  getSpinWheel,
  playSpinWheel,
  getMyCoupons,
  claimCouponByCode,
  getAdminWheel,
  updateAdminWheel,
  adminGetCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
  validateCouponPreview,
};
