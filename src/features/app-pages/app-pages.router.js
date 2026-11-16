const { Router } = require('express');
const { requireAuth, requireSuperAdmin } = require('../../core/middleware/auth');
const ctrl = require('./app-pages.controller');

const router = Router();

// App-facing state (hide/lock map) — public: guest sessions need it too.
router.get('/state', ctrl.getState);

// Staff management — SUPER_ADMIN only.
router.get('/:app', requireAuth, requireSuperAdmin, ctrl.listPages);
router.get('/:app/maintenance', requireAuth, requireSuperAdmin, ctrl.getMaintenance);
router.put('/:app/maintenance', requireAuth, requireSuperAdmin, ctrl.setMaintenance);
router.put('/:app/:pageKey', requireAuth, requireSuperAdmin, ctrl.updatePage);

module.exports = router;
