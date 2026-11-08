// src/features/reviews/reviews.router.js

const express = require('express');
const router = express.Router();
const {
  getProductReviews,
  getUserReviews,
  createReview,
  updateReview,
  deleteReview,
  getProductReviewStats
} = require('./reviews.controller');
const { authenticate } = require('../../core/middleware/auth');

// Public routes - parameterized routes must come first
router.get('/product/:productId/stats', getProductReviewStats);
router.get('/product/:productId', getProductReviews);

// Protected routes (require authentication)
router.get('/user', authenticate, getUserReviews);
router.post('/product/:productId', authenticate, createReview);
router.put('/:reviewId', authenticate, updateReview);
router.delete('/:reviewId', authenticate, deleteReview);

module.exports = router;
