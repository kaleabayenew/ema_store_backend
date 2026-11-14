const { Router } = require('express');
const ctrl = require('./products.controller');
const { requireAuth, requireSuperAdmin, optionalAuth } = require('../../core/middleware/auth');

const router = Router();

// ── Public endpoints (for customers) ─────────────────────────────────────
router.get('/', ctrl.getAllProducts);
router.get('/new-arrivals', ctrl.getNewArrivals);
router.get('/flash-deals', ctrl.getFlashDealProducts);
router.get('/popular', ctrl.getPopularProducts);
router.get('/categories', ctrl.getAllCategories);
router.get('/:id', ctrl.getProductById);
router.get('/:id/reviews', ctrl.getProductReviews);
router.get('/:id/seller-offers', ctrl.getSellerOffers);
router.get('/:id/reactions', optionalAuth, ctrl.getProductReactions);
router.get('/:id/viewers', ctrl.getProductViewers);

// ── Admin endpoints (Super Admin only — customers must not mutate catalog) ──
router.post('/', requireSuperAdmin, ctrl.createProduct);
router.patch('/:id', requireSuperAdmin, ctrl.updateProduct);
router.delete('/:id', requireSuperAdmin, ctrl.deleteProduct);
router.post('/:id/reactions', requireAuth, ctrl.setProductReaction);

module.exports = router;
