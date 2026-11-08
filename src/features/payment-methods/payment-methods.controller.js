// src/features/payment-methods/payment-methods.controller.js

const paymentMethodsService = require('./payment-methods.service');

// Get all active payment methods
exports.getActivePaymentMethods = async (req, res) => {
  try {
    const result = await paymentMethodsService.getActivePaymentMethods();
    res.json(result);
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payment methods'
    });
  }
};

// Get payment method by code
exports.getPaymentMethodByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const result = await paymentMethodsService.getPaymentMethodByCode(code);
    res.json(result);
  } catch (error) {
    console.error('Error fetching payment method:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Payment method not found'
    });
  }
};
