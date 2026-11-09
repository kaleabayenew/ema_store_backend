const { Router } = require('express');
const ctrl = require('./profile.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',       ...guard, ctrl.getProfile);
router.put('/',       ...guard, ctrl.updateProfile);
router.post('/logo',  ...guard, ctrl.updateLogo);

module.exports = router;
