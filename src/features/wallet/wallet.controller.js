// src/features/wallet/wallet.controller.js

const walletService = require('./wallet.service');

// Get user's transactions
exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0, type, status, start_date, end_date } = req.query;

    const result = await walletService.getTransactions(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      type,
      status,
      startDate: start_date,
      endDate: end_date
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch transactions'
    });
  }
};

// Get transaction by ID
exports.getTransactionById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await walletService.getTransactionById(id, userId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Transaction not found'
    });
  }
};

// Get transaction summary
exports.getTransactionSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await walletService.getTransactionSummary(userId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching transaction summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch transaction summary'
    });
  }
};

// Create a new transaction (admin only or internal use)
exports.createTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, amount, type, status, metadata } = req.body;

    const result = await walletService.createTransaction(userId, {
      title,
      description,
      amount,
      type,
      status,
      metadata
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create transaction'
    });
  }
};

// Get balance history
exports.getBalanceHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'start_date and end_date are required'
      });
    }

    const result = await walletService.getBalanceHistory(
      userId,
      start_date,
      end_date
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching balance history:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch balance history'
    });
  }
};
