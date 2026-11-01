const { Router } = require('express');
const ctrl = require('./partners.controller');

const router = Router();

// Get all partners (for admin panel)
router.get('/partners', ctrl.getAllPartners);
router.get('/partners/:id', ctrl.getPartnerById);
router.patch('/partners/:id/status', ctrl.updatePartnerStatus);

module.exports = router;
