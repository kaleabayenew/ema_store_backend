const { Router } = require('express');
const ctrl = require('./delivery.controller');

const router = Router();

// Delivery agents authenticate with their agent code (x-agent-code header) —
// the same code printed in their ID card QR.
router.get('/qr', ctrl.getQr);
router.get('/offers', ctrl.listOffers);
router.post('/offers/:orderId/accept', ctrl.acceptOffer);
router.post('/offers/:orderId/decline', ctrl.declineOffer);

// Active job & lifecycle endpoints
router.get('/active', ctrl.getActiveDelivery);
router.post('/orders/:orderId/pickup/confirm', ctrl.confirmPickup);
router.post('/orders/:orderId/deliver/scan', ctrl.scanDelivery);

module.exports = router;
