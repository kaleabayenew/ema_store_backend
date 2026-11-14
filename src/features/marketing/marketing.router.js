const { Router } = require('express');
const { authenticate, requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./marketing.controller');

const router = Router();

// ── Customer routes ───────────────────────────────────────────────────────────

router.get('/spin-wheel', authenticate, ctrl.getSpinWheel);
router.post('/spin-wheel/play', authenticate, ctrl.playSpinWheel);
router.get('/coupons/my-coupons', authenticate, ctrl.getMyCoupons);
router.post('/coupons/claim', authenticate, ctrl.claimCouponByCode);

// ── Admin routes ──────────────────────────────────────────────────────────────

router.get('/admin/wheel-config', authenticate, requireStaff, ctrl.getAdminWheel);
router.put('/admin/wheel-config', authenticate, requireStaff, ctrl.updateAdminWheel);

module.exports = router;
