// src/features/auctions/auctions.router.js

const express = require('express');
const router = express.Router();
const {
  getActiveAuctions,
  getAuctionById,
  placeBid,
  getUserBids,
  getUserWonAuctions,
  createAuction
} = require('./auctions.controller');
const { authenticate } = require('../../core/middleware/auth');

// Protected routes (require authentication) - must come before /:id
router.get('/user/bids', authenticate, getUserBids);
router.get('/user/won', authenticate, getUserWonAuctions);

// Public routes
router.get('/', getActiveAuctions);
router.get('/:id', getAuctionById);

// Protected routes (require authentication)
router.post('/:id/bid', authenticate, placeBid);

// Admin routes (require admin authentication)
router.post('/', authenticate, createAuction);

module.exports = router;
