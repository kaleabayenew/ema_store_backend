const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// All order endpoints require authentication
router.post('/', requireAuth, ctrl.createOrder);
router.get('/', requireAuth, ctrl.getUserOrders);
router.get('/:id', requireAuth, ctrl.getOrderById);

module.exports = router;
