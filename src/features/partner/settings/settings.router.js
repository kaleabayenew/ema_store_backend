const { Router } = require('express');
const ctrl = require('./settings.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',           ...guard, ctrl.getSettings);
router.put('/',           ...guard, ctrl.updateSettings);
router.post('/fcm-token', ...guard, ctrl.registerFcmToken);

module.exports = router;
