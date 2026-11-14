const { Router } = require('express');
const { authenticate, requireStaff, adminOnly } = require('../../core/middleware/auth');
const ctrl = require('./announcements.controller');

const router = Router();

// All announcement endpoints require a logged-in staff account.
router.use(authenticate, requireStaff);

// Reads — any staff role.
router.get('/announcements', ctrl.list);
router.get('/announcements/:id', ctrl.getOne);

// Writes — broadcasts reach every customer/partner/ride user, so mutations
// are restricted to ADMIN / SUPER_ADMIN.
router.post('/announcements', adminOnly, ctrl.create);
router.put('/announcements/:id', adminOnly, ctrl.update);
router.delete('/announcements/:id', adminOnly, ctrl.remove);
router.post('/announcements/:id/publish', adminOnly, ctrl.publish);

module.exports = router;
