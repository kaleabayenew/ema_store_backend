const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',                        ...guard, ctrl.getOrders);
router.get('/:id',                     ...guard, ctrl.getOrder);
router.patch('/:id/status',            ...guard, ctrl.updateStatus);
router.patch('/:id/payment-method',    ...guard, ctrl.updatePaymentMethod);
router.post('/:id/handover/scan',      ...guard, ctrl.scanHandover);
router.post('/:id/handover/confirm',   ...guard, ctrl.confirmHandover);

module.exports = router;