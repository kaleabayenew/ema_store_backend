const { Router } = require('express');
const ctrl = require('./flash-deals.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// ── Public endpoints (for customers) ─────────────────────────────────────
router.get('/active', ctrl.getActiveFlashDeals);
router.get('/:id/products', ctrl.getFlashDealProducts);

// ── Admin endpoints (require auth) ───────────────────────────────────────
router.get('/', requireAuth, ctrl.getAllFlashDeals);
router.get('/:id', requireAuth, ctrl.getFlashDealById);
router.post('/', requireAuth, ctrl.createFlashDeal);
router.patch('/:id', requireAuth, ctrl.updateFlashDeal);
router.delete('/:id', requireAuth, ctrl.deleteFlashDeal);

module.exports = router;
