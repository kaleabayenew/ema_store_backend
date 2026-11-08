// src/features/reviews/reviews.controller.js

const reviewsService = require('./reviews.service');

// Get reviews for a product
async function getProductReviews(req, res) {
  try {
    const { productId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const result = await reviewsService.getProductReviews(
      productId,
      parseInt(limit),
      parseInt(offset)
    );
    res.json(result);
  } catch (error) {
    console.error('Error fetching product reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: error.message
    });
  }
}

// Get user's reviews
async function getUserReviews(req, res) {
  try {
    const userId = req.user?.id;
    const { limit = 20, offset = 0 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await reviewsService.getUserReviews(
      userId,
      parseInt(limit),
      parseInt(offset)
    );
    res.json(result);
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: error.message
    });
  }
}

// Create a review
async function createReview(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;
    const { rating, title, comment } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    if (!rating) {
      return res.status(400).json({
        success: false,
        message: 'Rating is required'
      });
    }

    const result = await reviewsService.createReview(userId, productId, {
      rating,
      title,
      comment
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create review'
    });
  }
}

// Update a review
async function updateReview(req, res) {
  try {
    const userId = req.user?.id;
    const { reviewId } = req.params;
    const { rating, title, comment } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        message: 'Review ID is required'
      });
    }

    const result = await reviewsService.updateReview(reviewId, userId, {
      rating,
      title,
      comment
    });
    res.json(result);
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update review'
    });
  }
}

// Delete a review
async function deleteReview(req, res) {
  try {
    const userId = req.user?.id;
    const { reviewId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        message: 'Review ID is required'
      });
    }

    const result = await reviewsService.deleteReview(reviewId, userId);
    res.json(result);
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Failed to delete review'
    });
  }
}

// Get review statistics for a product
async function getProductReviewStats(req, res) {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const result = await reviewsService.getProductReviewStats(productId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching review stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch review statistics',
      error: error.message
    });
  }
}

module.exports = {
  getProductReviews,
  getUserReviews,
  createReview,
  updateReview,
  deleteReview,
  getProductReviewStats
};
