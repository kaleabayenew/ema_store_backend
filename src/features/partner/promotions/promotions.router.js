const { Router } = require('express');
const ctrl = require('./promotions.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',       ...guard, ctrl.getPromotions);
router.post('/',      ...guard, ctrl.createPromotion);
router.put('/:id',    ...guard, ctrl.updatePromotion);
router.delete('/:id', ...guard, ctrl.deletePromotion);

module.exports = router;
