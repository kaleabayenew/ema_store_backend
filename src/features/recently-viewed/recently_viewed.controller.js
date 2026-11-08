// src/features/recently-viewed/recently_viewed.controller.js

const recentlyViewedService = require('./recently_viewed.service');

// Get user's recently viewed products
async function getUserRecentlyViewed(req, res) {
  try {
    const userId = req.user?.id;
    const { limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await recentlyViewedService.getUserRecentlyViewed(
      userId,
      parseInt(limit)
    );
    res.json(result);
  } catch (error) {
    console.error('Error fetching recently viewed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recently viewed',
      error: error.message
    });
  }
}

// Track product view
async function trackProductView(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.body;

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

    const result = await recentlyViewedService.trackProductView(userId, productId);
    res.json(result);
  } catch (error) {
    console.error('Error tracking product view:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track product view',
      error: error.message
    });
  }
}

// Remove product from recently viewed
async function removeFromRecentlyViewed(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

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

    const result = await recentlyViewedService.removeFromRecentlyViewed(userId, productId);
    res.json(result);
  } catch (error) {
    console.error('Error removing from recently viewed:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Failed to remove from recently viewed'
    });
  }
}

// Clear recently viewed
async function clearRecentlyViewed(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await recentlyViewedService.clearRecentlyViewed(userId);
    res.json(result);
  } catch (error) {
    console.error('Error clearing recently viewed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear recently viewed',
      error: error.message
    });
  }
}

module.exports = {
  getUserRecentlyViewed,
  trackProductView,
  removeFromRecentlyViewed,
  clearRecentlyViewed
};
