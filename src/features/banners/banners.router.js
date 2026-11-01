const { Router } = require('express');
const ctrl = require('./banners.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// Public endpoint
router.get('/payment', ctrl.getPaymentBanner);

// Admin endpoints (require auth)
router.post('/payment', requireAuth, ctrl.createPaymentBanner);
router.get('/payment/all', requireAuth, ctrl.getAllPaymentBanners);
router.patch('/payment/:id', requireAuth, ctrl.updatePaymentBanner);
router.delete('/payment/:id', requireAuth, ctrl.deletePaymentBanner);

module.exports = router;
