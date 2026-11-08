// src/features/wishlist/wishlist.controller.js

const wishlistService = require('./wishlist.service');

// Get user's wishlist
async function getUserWishlist(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await wishlistService.getUserWishlist(userId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist',
      error: error.message
    });
  }
}

// Add product to wishlist
async function addToWishlist(req, res) {
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

    const result = await wishlistService.addToWishlist(userId, productId);
    res.json(result);
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add to wishlist',
      error: error.message
    });
  }
}

// Remove product from wishlist
async function removeFromWishlist(req, res) {
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

    const result = await wishlistService.removeFromWishlist(userId, productId);
    res.json(result);
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Failed to remove from wishlist'
    });
  }
}

// Check if product is in wishlist
async function isInWishlist(req, res) {
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

    const result = await wishlistService.isInWishlist(userId, productId);
    res.json(result);
  } catch (error) {
    console.error('Error checking wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check wishlist',
      error: error.message
    });
  }
}

// Clear wishlist
async function clearWishlist(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await wishlistService.clearWishlist(userId);
    res.json(result);
  } catch (error) {
    console.error('Error clearing wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear wishlist',
      error: error.message
    });
  }
}

module.exports = {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
  clearWishlist
};
