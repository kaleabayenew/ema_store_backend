const { Router } = require('express');
const ctrl = require('./inventory.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',                         ...guard, ctrl.getInventory);
router.patch('/:productId/stock',       ...guard, ctrl.updateStock);

module.exports = router;
