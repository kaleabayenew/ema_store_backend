const express = require('express');
const router = express.Router();
const {
  getReviews,
  addReview,
  markHelpful,
} = require('./reviews.controller');
const { requireAuth } = require('../../core/middleware/auth');

// GET /api/v1/reviews?productId=
router.get('/', getReviews);

// POST /api/v1/reviews
router.post('/', requireAuth, addReview);

// PATCH /api/v1/reviews/:id/helpful
router.patch('/:id/helpful', markHelpful);

module.exports = router;
