const { Router } = require('express');
const ctrl = require('./dashboard.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();

router.get('/', requireAuth, requirePartner, ctrl.getStats);

module.exports = router;
