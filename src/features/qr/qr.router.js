const express = require('express');
const { requireAuth } = require('../../core/middleware/auth');
const qrController = require('./qr.controller');

const router = express.Router();

// Generate dynamic 5-minute QR code (requires login)
router.get('/my-code', requireAuth, qrController.getMyQrCode);

// Verify scanned QR code (can be called by any scanner device)
router.post('/verify', qrController.verifyQrCode);

module.exports = router;
