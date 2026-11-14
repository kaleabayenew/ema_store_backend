const { Router } = require('express');
const ctrl = require('./banners.controller');
const { requireStaff } = require('../../core/middleware/auth');

const router = Router();

// Public endpoint
router.get('/payment', ctrl.getPaymentBanner);

// Admin endpoints (require auth)
router.post('/payment', requireStaff, ctrl.createPaymentBanner);
router.get('/payment/all', requireStaff, ctrl.getAllPaymentBanners);
router.patch('/payment/:id', requireStaff, ctrl.updatePaymentBanner);
router.delete('/payment/:id', requireStaff, ctrl.deletePaymentBanner);

module.exports = router;
