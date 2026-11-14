const { Router } = require('express');
const { authenticate, requireStaff, adminOnly, requireSuperAdmin } = require('../../core/middleware/auth');
const partnerCtrl   = require('./partners.controller');
const orderCtrl     = require('./orders.controller');
const dashboardCtrl = require('./dashboard.controller');
const approvalsCtrl = require('./approvals.controller');
const communityCtrl = require('./community.controller');

const router = Router();

// All admin endpoints require a logged-in staff account
router.use(authenticate, requireStaff);

// Dashboard
router.get('/dashboard', dashboardCtrl.getDashboard);

// Approvals (pending partners & products)
router.get('/approvals',                        approvalsCtrl.getApprovals);
router.post('/approvals/:type/:id/review',      requireSuperAdmin, approvalsCtrl.reviewApproval);

// Reviews & Feedback moderation
router.get('/reviews',                  communityCtrl.getAllReviews);
router.patch('/reviews/:id',            adminOnly, communityCtrl.updateReview);
router.delete('/reviews/:id',           adminOnly, communityCtrl.deleteReview);
router.get('/feedback',                 communityCtrl.getAllFeedback);
router.patch('/feedback/:id/status',    adminOnly, communityCtrl.updateFeedbackStatus);
router.delete('/feedback/:id',          adminOnly, communityCtrl.deleteFeedback);

// Partners
router.get('/partners',              partnerCtrl.getAllPartners);
router.get('/partners/:id',          partnerCtrl.getPartnerById);
router.patch('/partners/:id/status', requireSuperAdmin, partnerCtrl.updatePartnerStatus);

// Orders
router.get('/orders',                orderCtrl.getAllOrders);
router.get('/orders/:id',            orderCtrl.getOrderById);
router.patch('/orders/:id/status',   adminOnly, orderCtrl.updateOrderStatus);

module.exports = router;
