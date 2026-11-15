const { Router } = require('express');
const { authenticate, requireAuth, requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./app-pages.controller');

const router = Router();

// App-facing state (hide/lock map) — any authenticated user.
router.get('/state', authenticate, ctrl.getState);

// Staff management.
router.get('/:app', requireAuth, requireStaff, ctrl.listPages);
router.put('/:app/:pageKey', requireAuth, requireStaff, ctrl.updatePage);

module.exports = router;
