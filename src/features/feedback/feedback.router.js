const { Router } = require('express');
const ctrl = require('./feedback.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

router.post('/', requireAuth, ctrl.submitFeedback);

module.exports = router;
