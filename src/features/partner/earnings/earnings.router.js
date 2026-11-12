const { Router } = require('express');
const ctrl = require('./earnings.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',              ...guard, ctrl.getEarnings);
router.get('/transactions',  ...guard, ctrl.getTransactions);
router.post('/payout',       ...guard, ctrl.requestPayout);
router.post('/transfer',     ...guard, ctrl.requestTransfer);

module.exports = router;
