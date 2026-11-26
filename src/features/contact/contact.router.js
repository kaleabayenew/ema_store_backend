const { Router } = require('express');
const { authenticate, requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./contact.controller');

const router = Router();

// Public — apps fetch contact channels without auth
router.get('/', ctrl.getContact);

// Admin — manage the channels shown in the apps
router.get('/admin', authenticate, requireStaff, ctrl.getAdminContact);
router.put('/admin', authenticate, requireStaff, ctrl.updateAdminContact);

module.exports = router;
