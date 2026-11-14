// src/features/admin/credits.router.js

const { Router } = require('express');
const { requireStaff, requireRoles } = require('../../core/middleware/auth');
const ctrl = require('./credits.controller');

const router = Router();

// Credits/wallet data is staff-only.
router.use(requireStaff);

// Money movement and coin configuration are limited to finance/admin roles —
// support/marketing staff must not be able to mint balance.
const MONEY_ROLES = requireRoles('SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'FINANCE');

router.get('/credits/transactions', ctrl.listTransactions);
router.get('/credits/users', ctrl.listUsers);
router.post('/credits/adjust', MONEY_ROLES, ctrl.adjust);
router.get('/credits/summary', ctrl.summary);
router.get('/credits/coin-rate', ctrl.coinRate);
router.put('/credits/coin-rate', MONEY_ROLES, ctrl.updateCoinRate);
router.get('/credits/coin-settings', ctrl.coinSettings);
router.put('/credits/coin-settings', MONEY_ROLES, ctrl.updateCoinSettings);
router.put('/credits/product-coin-price', MONEY_ROLES, ctrl.productCoinPrice);

module.exports = router;
