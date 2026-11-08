const { Router } = require('express');
const ctrl = require('./about.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// Public endpoint - get active about content
router.get('/', ctrl.getAboutContent);

// Admin endpoints (require auth)
router.post('/', requireAuth, ctrl.createAboutContent);
router.get('/all', requireAuth, ctrl.getAllAboutContent);
router.patch('/:id', requireAuth, ctrl.updateAboutContent);
router.delete('/:id', requireAuth, ctrl.deleteAboutContent);

module.exports = router;
