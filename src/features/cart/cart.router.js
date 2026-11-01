const { Router } = require('express');
const ctrl = require('./cart.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// All cart endpoints require authentication
router.get('/', requireAuth, ctrl.getUserCart);
router.post('/', requireAuth, ctrl.addToCart);
router.patch('/:itemId', requireAuth, ctrl.updateCartItem);
router.delete('/:itemId', requireAuth, ctrl.removeFromCart);
router.delete('/', requireAuth, ctrl.clearCart);

module.exports = router;
