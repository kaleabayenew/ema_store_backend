const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
const ctrl = require('./users.controller');

const router = Router();

// All staff-management routes require auth + Super Admin
router.use(authenticate, ctrl.requireSuperAdmin);

router.get('/users',            ctrl.list);
router.get('/users/:id',        ctrl.getOne);
router.post('/users',           ctrl.create);
router.patch('/users/:id',      ctrl.update);
router.patch('/users/:id/status', ctrl.setStatus);
router.post('/users/:id/reset-password', ctrl.resetPassword);

module.exports = router;
