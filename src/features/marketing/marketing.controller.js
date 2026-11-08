const {
  getWheelConfig,
  playSpin,
  getUserCoupons,
  claimCoupon,
  getAdminWheelConfig,
  updateWheelConfig,
} = require('./marketing.service');
const { ok } = require('../../core/utils/response');

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
    if (!code?.trim()) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }
    const coupon = await claimCoupon(req.user.id, code.trim());
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

module.exports = {
  getSpinWheel,
  playSpinWheel,
  getMyCoupons,
  claimCouponByCode,
  getAdminWheel,
  updateAdminWheel,
};
