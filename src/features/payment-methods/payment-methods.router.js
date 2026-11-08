// src/features/payment-methods/payment-methods.router.js

const express = require('express');
const router = express.Router();
const paymentMethodsController = require('./payment-methods.controller');

// GET /api/v1/payment-methods - Get all active payment methods
router.get('/', paymentMethodsController.getActivePaymentMethods);

// GET /api/v1/payment-methods/:code - Get payment method by code
router.get('/:code', paymentMethodsController.getPaymentMethodByCode);

module.exports = router;
