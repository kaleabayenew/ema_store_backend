const { Router } = require('express');
const { authenticate, requireStaff, requireRoles, adminOnly, requireSuperAdmin } = require('../../core/middleware/auth');
const partnerCtrl = require('./partners.controller');
const locationsCtrl = require('./locations.controller');
const orderCtrl = require('./orders.controller');
const dashboardCtrl = require('./dashboard.controller');
const approvalsCtrl = require('./approvals.controller');
const communityCtrl = require('./community.controller');
const agentsCtrl = require('./agents.controller');
const feeCtrl = require('../delivery/delivery_fee.controller');
const overdueCtrl = require('./delivery_overdue.controller');
const balanceCtrl = require('./balance.controller');

const router = Router();

// All admin endpoints require a logged-in staff account
router.use(authenticate, requireStaff);

// Dashboard
router.get('/dashboard', dashboardCtrl.getDashboard);
router.get('/locations', requireRoles('SUPER_ADMIN', 'ADMIN', 'MANAGEMENT'), locationsCtrl.getLocationMap);

// Approvals (pending partners & products)
router.get('/approvals', approvalsCtrl.getApprovals);
router.post('/approvals/:type/:id/review', adminOnly, approvalsCtrl.reviewApproval);

// Reviews & Feedback moderation
router.get('/reviews', communityCtrl.getAllReviews);
router.patch('/reviews/:id', adminOnly, communityCtrl.updateReview);
router.delete('/reviews/:id', adminOnly, communityCtrl.deleteReview);
router.get('/feedback', communityCtrl.getAllFeedback);
router.patch('/feedback/:id/status', adminOnly, communityCtrl.updateFeedbackStatus);
router.delete('/feedback/:id', adminOnly, communityCtrl.deleteFeedback);

// Delivery agents (ride riders)
router.get('/agents/profile-requests', agentsCtrl.listProfileRequests);
router.post('/agents/profile-requests/:id/review', adminOnly, agentsCtrl.reviewProfileRequest);
router.get('/agents', agentsCtrl.listAgents);
router.post('/agents', adminOnly, agentsCtrl.createAgent);
router.get('/agents/:id/deliveries', agentsCtrl.getAgentDeliveries);
router.get('/agents/:id', agentsCtrl.getAgent);
router.patch('/agents/:id/status', adminOnly, agentsCtrl.setAgentStatus);
router.post('/agents/:id/reset-password', adminOnly, agentsCtrl.resetAgentPassword);

// Delivery fee pricing (distance + weight + material)
// Overdue / problem deliveries — admin review & reassignment
router.get('/delivery/overdue', overdueCtrl.listOverdue);
router.post('/delivery/:orderId/reassign', adminOnly, overdueCtrl.reassign);

router.get('/delivery-fee', feeCtrl.adminGetSettings);
router.put('/delivery-fee', adminOnly, feeCtrl.adminUpdateSettings);

// Platform balance ledger (service fees + commissions)
router.get('/balance', balanceCtrl.getBalance);
router.get('/balance/breakdown', balanceCtrl.getBalanceBreakdown);

// Partners
router.get('/partners', partnerCtrl.getAllPartners);
router.get('/partners/:id', partnerCtrl.getPartnerById);
router.patch('/partners/:id/status', requireSuperAdmin, partnerCtrl.updatePartnerStatus);
router.post('/partners/:id/reset-password', adminOnly, partnerCtrl.resetPartnerPassword);

// Orders
router.get('/orders', orderCtrl.getAllOrders);
router.get('/orders/:id', orderCtrl.getOrderById);
router.patch('/orders/:id/status', adminOnly, orderCtrl.updateOrderStatus);

module.exports = router;
