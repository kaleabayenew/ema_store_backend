// src/features/admin/credits.router.js

const { Router } = require('express');
const { requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./credits.controller');

const router = Router();

// Credits/wallet data is staff-only.
router.use(requireStaff);

router.get('/credits/transactions', ctrl.listTransactions);
router.get('/credits/users', ctrl.listUsers);
router.post('/credits/adjust', ctrl.adjust);
router.get('/credits/summary', ctrl.summary);
router.get('/credits/coin-rate', ctrl.coinRate);
router.put('/credits/coin-rate', ctrl.updateCoinRate);
router.get('/credits/coin-settings', ctrl.coinSettings);
router.put('/credits/coin-settings', ctrl.updateCoinSettings);
router.put('/credits/product-coin-price', ctrl.productCoinPrice);

module.exports = router;
