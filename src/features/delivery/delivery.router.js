const { Router } = require('express');
const ctrl = require('./delivery.controller');
const feeCtrl = require('./delivery_fee.controller');

const router = Router();

// Delivery fee rates + checkout preview (public — customer app checkout)
router.get('/fee-settings', feeCtrl.getFeeSettings);
router.post('/fee-preview', feeCtrl.previewFee);

// Delivery agents authenticate with their agent code (x-agent-code header) —
// the same code printed in their ID card QR.
router.get('/qr', ctrl.getQr);
router.get('/offers', ctrl.listOffers);
// Rider app posts { lat, lng } here every ~10 s so customers can follow the ride.
router.post('/location', ctrl.updateLocation);
router.post('/offers/:orderId/accept', ctrl.acceptOffer);
router.post('/offers/:orderId/decline', ctrl.declineOffer);

// Active job & lifecycle endpoints
router.get('/active', ctrl.getActiveDeliveries);
router.get('/active/:orderId', ctrl.getActiveDelivery);
router.get('/history', ctrl.getHistory);
router.get('/earnings', ctrl.getEarnings);
router.get('/wallet-transactions', ctrl.getWalletTransactions);
router.get('/notifications', ctrl.getNotifications);
router.post('/notifications/read-all', ctrl.markNotificationsRead);
router.get('/zones', ctrl.getDeliveryZones);
router.get('/route', ctrl.getRoute);
router.post('/orders/:orderId/pickup/confirm', ctrl.confirmPickup);
router.post('/orders/:orderId/deliver/scan', ctrl.scanDelivery);
router.post('/orders/:orderId/problem', ctrl.reportIssue);
router.post('/orders/:orderId/arrived', ctrl.markArrived);

module.exports = router;