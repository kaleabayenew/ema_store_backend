const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
const ctrl = require('./support.controller');

const router = Router();

router.post('/',                  authenticate, ctrl.createTicket);
router.get('/my-tickets',         authenticate, ctrl.getMyTickets);
router.get('/',                  authenticate, ctrl.getTickets);
router.get('/:id',               authenticate, ctrl.getOne);
router.post('/:id/reply',        authenticate, ctrl.reply);
router.patch('/:id/status',      authenticate, ctrl.setStatus);

module.exports = router;
