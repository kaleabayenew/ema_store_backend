const { Router } = require('express');
const ctrl = require('./reviews.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',              ...guard, ctrl.getReviews);
router.post('/:id/reply',    ...guard, ctrl.replyToReview);

module.exports = router;
