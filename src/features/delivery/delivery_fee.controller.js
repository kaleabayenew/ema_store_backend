const { ok } = require('../../core/utils/response');
const fee = require('./delivery_fee.service');

// GET /api/v1/delivery/fee-settings — current rates (public, read-only)
const getFeeSettings = async (req, res, next) => {
  try {
    ok(res, { settings: await fee.getSettings() });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/delivery/fee-preview — customer checkout fee estimate
// body: { shippingAddress, items: [{ productId|product_id, name?, quantity }] }
const previewFee = async (req, res, next) => {
  try {
    const { shippingAddress, items } = req.body || {};
    if (!shippingAddress || typeof shippingAddress !== 'string') {
      return res.status(400).json({ success: false, message: 'shippingAddress is required.' });
    }
    const resolved = await fee.resolveItemsForFee(items);
    const result = await fee.computeOrderFee({
      items: resolved.length ? resolved : [{ name: 'Product', quantity: 1 }],
      shippingAddress,
    });
    const settings = await fee.getSettings();
    ok(res, {
      feeCents: result.feeCents,
      feeEtb: result.feeCents / 100,
      serviceFeeCents: settings.serviceFeeCents,
      serviceFeeEtb: settings.serviceFeeCents / 100,
      legs: result.legs.map((l) => ({
        feeCents: l.feeCents,
        breakdown: l.breakdown,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/admin/delivery-fee — admin: current rates
const adminGetSettings = async (req, res, next) => {
  try {
    ok(res, { settings: await fee.getSettings() });
  } catch (err) {
    next(err);
  }
};

// PUT /api/v1/admin/delivery-fee — admin: update rates
const adminUpdateSettings = async (req, res, next) => {
  try {
    ok(res, { settings: await fee.updateSettings(req.body || {}) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getFeeSettings,
  previewFee,
  adminGetSettings,
  adminUpdateSettings,
};
