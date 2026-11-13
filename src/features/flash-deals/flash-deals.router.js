const { Router } = require('express');
const ctrl = require('./flash-deals.controller');
const { requireAuth, requireStaff } = require('../../core/middleware/auth');

const router = Router();

// ── Public endpoints (for customers) ─────────────────────────────────────
router.get('/active', ctrl.getActiveFlashDeals);
router.get('/:id/products', ctrl.getFlashDealProducts);

// ── Admin endpoints (staff only) ─────────────────────────────────────────
router.get('/', requireAuth, requireStaff, ctrl.getAllFlashDeals);
router.get('/:id', requireAuth, requireStaff, ctrl.getFlashDealById);
router.post('/', requireAuth, requireStaff, ctrl.createFlashDeal);
router.patch('/:id', requireAuth, requireStaff, ctrl.updateFlashDeal);
router.delete('/:id', requireAuth, requireStaff, ctrl.deleteFlashDeal);

module.exports = router;