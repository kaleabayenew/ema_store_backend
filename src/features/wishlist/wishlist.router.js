// src/features/wishlist/wishlist.router.js

const express = require('express');
const router = express.Router();
const {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
  clearWishlist
} = require('./wishlist.controller');
const { authenticate } = require('../../core/middleware/auth');

// All routes require authentication
// Specific routes must come before parameterized routes
router.get('/check/:productId', authenticate, isInWishlist);
router.get('/', authenticate, getUserWishlist);
router.post('/', authenticate, addToWishlist);
router.delete('/:productId', authenticate, removeFromWishlist);
router.delete('/', authenticate, clearWishlist);

module.exports = router;
