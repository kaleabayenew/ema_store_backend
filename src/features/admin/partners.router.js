const { Router } = require('express');
const partnerCtrl   = require('./partners.controller');
const orderCtrl     = require('./orders.controller');
const dashboardCtrl = require('./dashboard.controller');

const router = Router();

// Dashboard
router.get('/dashboard', dashboardCtrl.getDashboard);

// Partners
router.get('/partners',              partnerCtrl.getAllPartners);
router.get('/partners/:id',          partnerCtrl.getPartnerById);
router.patch('/partners/:id/status', partnerCtrl.updatePartnerStatus);

// Orders
router.get('/orders',                orderCtrl.getAllOrders);
router.get('/orders/:id',            orderCtrl.getOrderById);
router.patch('/orders/:id/status',   orderCtrl.updateOrderStatus);

module.exports = router;
