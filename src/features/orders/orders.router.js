const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// All order endpoints require authentication
router.use(requireAuth);

// Admin orders endpoint
router.get('/all', ctrl.getAllOrders);
router.get('/admin', ctrl.getAllOrders);
router.patch('/:id/status', ctrl.updateStatus);

// Customer endpoints
router.post('/', ctrl.createOrder);
router.get('/', ctrl.getUserOrders);
router.get('/:id', ctrl.getOrderById);

module.exports = router;
