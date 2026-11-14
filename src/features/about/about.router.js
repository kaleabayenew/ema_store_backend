const { Router } = require('express');
const ctrl = require('./about.controller');
const { requireStaff } = require('../../core/middleware/auth');

const router = Router();

// Public endpoint - get active about content
router.get('/', ctrl.getAboutContent);

// Admin endpoints (require auth)
router.post('/', requireStaff, ctrl.createAboutContent);
router.get('/all', requireStaff, ctrl.getAllAboutContent);
router.patch('/:id', requireStaff, ctrl.updateAboutContent);
router.delete('/:id', requireStaff, ctrl.deleteAboutContent);

module.exports = router;
