const { Router } = require('express');
const ctrl = require('./products.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// ── Public endpoints (for customers) ─────────────────────────────────────
router.get('/', ctrl.getAllProducts);
router.get('/categories', ctrl.getAllCategories);
router.get('/:id', ctrl.getProductById);
router.get('/:id/reviews', ctrl.getProductReviews);

// ── Admin/Partner endpoints (require auth) ───────────────────────────────
router.post('/', requireAuth, ctrl.createProduct);
router.patch('/:id', requireAuth, ctrl.updateProduct);
router.delete('/:id', requireAuth, ctrl.deleteProduct);

module.exports = router;
