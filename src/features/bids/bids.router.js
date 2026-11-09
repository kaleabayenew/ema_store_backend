const { Router } = require('express');
const { authenticate, optionalAuth } = require('../../core/middleware/auth');
const ctrl = require('./bids.controller');

const router = Router();

// Customer specific (must come before /:id)
router.get('/my-bids', authenticate, ctrl.fetchMyBids);
router.get('/user/bids', authenticate, ctrl.fetchMyBids);
router.get('/won', authenticate, ctrl.fetchWon);
router.get('/user/won', authenticate, ctrl.fetchWon);

// Browse bids / auctions (public with optional auth for personalization)
router.get('/', optionalAuth, ctrl.getAll);
router.get('/:id', optionalAuth, ctrl.getOne);

// Admin management
router.post('/', authenticate, ctrl.create);
router.patch('/:id', authenticate, ctrl.update);
router.delete('/:id', authenticate, ctrl.remove);

// Place bid (supports /:id/entries, /:id/bids, and /:id/bid)
router.post('/:id/entries', authenticate, ctrl.placeEntry);
router.post('/:id/bids', authenticate, ctrl.placeEntry);
router.post('/:id/bid', authenticate, ctrl.placeEntry);

module.exports = router;
