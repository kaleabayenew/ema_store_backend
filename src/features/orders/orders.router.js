const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// All order endpoints require authentication
router.use(requireAuth);

// ── Admin endpoints ──────────────────────────────────────────────────────
// Web calls: GET /admin/orders   → /api/v1/orders/admin
// Web calls: GET /admin/orders/:id → /api/v1/orders/admin/:id
// Web calls: PATCH /admin/orders/:id/status → /api/v1/orders/admin/:id/status
router.get('/admin', ctrl.getAllOrders);
router.get('/admin/:id', ctrl.getAdminOrderById);
router.patch('/admin/:id/status', ctrl.updateStatus);

// Legacy alias used by older code
router.get('/all', ctrl.getAllOrders);
// Also support PATCH /:id/status (Flutter may use this)
router.patch('/:id/status', ctrl.updateStatus);

// ── Customer endpoints ───────────────────────────────────────────────────
router.post('/', ctrl.createOrder);
router.get('/', ctrl.getUserOrders);
router.get('/:id', ctrl.getOrderById);

module.exports = router;
