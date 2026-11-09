const { Router } = require('express');
const ctrl = require('./orders.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',            ...guard, ctrl.getOrders);
router.get('/:id',         ...guard, ctrl.getOrder);
router.patch('/:id/status',...guard, ctrl.updateStatus);

module.exports = router;
