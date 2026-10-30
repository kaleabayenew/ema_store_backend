const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../../core/middleware/auth');
const {
  getActiveOffers,
  getOfferById,
  createOffer,
  updateOffer,
  deleteOffer,
} = require('./special-offers.controller');

// Get all active special offers (public)
router.get('/active', getActiveOffers);

// Get special offer by ID (public)
router.get('/:id', getOfferById);

// Create special offer (admin only)
router.post('/', authenticate, adminOnly, createOffer);

// Update special offer (admin only)
router.put('/:id', authenticate, adminOnly, updateOffer);

// Delete special offer (admin only)
router.delete('/:id', authenticate, adminOnly, deleteOffer);

module.exports = router;
