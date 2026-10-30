const express = require('express');
const router = express.Router();
const { authenticate } = require('../../core/middleware/auth');
const {
  generateCode,
  validateCode,
  applyCode,
  getStats,
  convertCoins,
} = require('./referral.controller');

// Generate referral code for authenticated user
router.post('/generate', authenticate, generateCode);

// Validate referral code (public)
router.get('/validate/:code', validateCode);

// Apply referral code during registration
router.post('/apply', authenticate, applyCode);

// Get user's referral stats
router.get('/stats', authenticate, getStats);

// Convert coins to balance
router.post('/convert', authenticate, convertCoins);

module.exports = router;
