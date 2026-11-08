// src/features/recently-viewed/recently_viewed.router.js

const express = require('express');
const router = express.Router();
const {
  getUserRecentlyViewed,
  trackProductView,
  removeFromRecentlyViewed,
  clearRecentlyViewed
} = require('./recently_viewed.controller');
const { authenticate } = require('../../core/middleware/auth');

// All routes require authentication
// Specific routes must come before parameterized routes
router.get('/', authenticate, getUserRecentlyViewed);
router.post('/', authenticate, trackProductView);
router.delete('/:productId', authenticate, removeFromRecentlyViewed);
router.delete('/', authenticate, clearRecentlyViewed);

module.exports = router;
