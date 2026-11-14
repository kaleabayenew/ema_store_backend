// src/features/wallet/wallet.router.js

const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const { authenticate } = require('../../core/middleware/auth');

// All wallet routes require authentication
router.use(authenticate);

// GET /api/v1/wallet/transactions - Get user's transactions
router.get('/transactions', walletController.getTransactions);

// GET /api/v1/wallet/transactions/summary - Get transaction summary
// NOTE: must be registered BEFORE /transactions/:id or ":id" swallows "summary".
router.get('/transactions/summary', walletController.getTransactionSummary);

// GET /api/v1/wallet/transactions/:id - Get transaction by ID
router.get('/transactions/:id', walletController.getTransactionById);

// POST /api/v1/wallet/transactions - Create a new transaction
router.post('/transactions', walletController.createTransaction);

// GET /api/v1/wallet/balance-history - Get balance history
router.get('/balance-history', walletController.getBalanceHistory);

// GET /api/v1/wallet/coin-config - Coin conversion/invite/product settings
router.get('/coin-config', walletController.getCoinConfig);

// POST /api/v1/wallet/deposit - Customer deposit request
router.post('/deposit', walletController.deposit);

// POST /api/v1/wallet/withdraw - Customer withdrawal request
router.post('/withdraw', walletController.withdraw);

module.exports = router;
