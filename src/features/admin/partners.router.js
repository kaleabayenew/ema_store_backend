const { Router } = require('express');
const ctrl = require('./partners.controller');

const router = Router();

// Get all partners (for admin panel)
router.get('/partners', ctrl.getAllPartners);

module.exports = router;
