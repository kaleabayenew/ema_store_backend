const { Router } = require('express');
const ctrl = require('./seasonal-promotions.controller');
const { requireAuth, requireStaff } = require('../../core/middleware/auth');

const router = Router();

// Public endpoints for the customer app
router.get('/active', ctrl.getActivePromotions);
router.get('/:id/products', ctrl.getPromotionProducts);

// Staff-only management endpoints
router.get('/', requireAuth, requireStaff, ctrl.getAllPromotions);
router.get('/:id', requireAuth, requireStaff, ctrl.getPromotionById);
router.post('/', requireAuth, requireStaff, ctrl.createPromotion);
router.patch('/:id', requireAuth, requireStaff, ctrl.updatePromotion);
router.delete('/:id', requireAuth, requireStaff, ctrl.deletePromotion);

module.exports = router;
