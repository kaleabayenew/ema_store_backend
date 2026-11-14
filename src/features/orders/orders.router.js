const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth, adminOnly } = require('../../core/middleware/auth');

const router = Router();

// All order endpoints require authentication
router.use(requireAuth);

// ── Admin endpoints ──────────────────────────────────────────────────────
// Web calls: GET /admin/orders   → /api/v1/orders/admin
// Web calls: GET /admin/orders/:id → /api/v1/orders/admin/:id
// Web calls: PATCH /admin/orders/:id/status → /api/v1/orders/admin/:id/status
router.get('/admin', adminOnly, ctrl.getAllOrders);
router.get('/admin/:id', adminOnly, ctrl.getAdminOrderById);
router.patch('/admin/:id/status', adminOnly, ctrl.updateStatus);

// Legacy alias used by older code
router.get('/all', adminOnly, ctrl.getAllOrders);
// Status changes are admin-only — customers must never set order status.
router.patch('/:id/status', adminOnly, ctrl.updateStatus);

// ── Customer endpoints ───────────────────────────────────────────────────
router.post('/', ctrl.createOrder);
router.get('/', ctrl.getUserOrders);
router.get('/:id', ctrl.getOrderById);

module.exports = router;
