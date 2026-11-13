const { Router } = require('express');
const { authenticate, requireAuth, requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./bids.controller');

const router = Router();

// Public routes that personalise (and decide how much to reveal) when a valid
// token is sent. Unlike optionalAuth this VERIFIES the token and loads the real
// role from the database; an invalid/missing token just means "anonymous".
const softAuth = (req, res, next) => {
  if (!req.headers.authorization) return next();
  requireAuth(req, res, () => next());
};

// Customer specific (must come before /:id)
router.get('/my-bids', authenticate, ctrl.fetchMyBids);
router.get('/user/bids', authenticate, ctrl.fetchMyBids);
router.get('/won', authenticate, ctrl.fetchWon);
router.get('/user/won', authenticate, ctrl.fetchWon);

// Browse bids / auctions (public with optional auth for personalization)
router.get('/', softAuth, ctrl.getAll);
router.get('/:id', softAuth, ctrl.getOne);

// Admin management
// (staff only - previously any logged-in customer could create/edit/delete auctions)
router.post('/', requireStaff, ctrl.create);
router.patch('/:id', requireStaff, ctrl.update);
router.delete('/:id', requireStaff, ctrl.remove);

// Place bid (supports /:id/entries, /:id/bids, and /:id/bid)
router.post('/:id/entries', authenticate, ctrl.placeEntry);
router.post('/:id/bids', authenticate, ctrl.placeEntry);
router.post('/:id/bid', authenticate, ctrl.placeEntry);

module.exports = router;