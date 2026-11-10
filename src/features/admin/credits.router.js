// src/features/admin/credits.router.js

const { Router } = require('express');
const { requireStaff } = require('../../core/middleware/auth');
const ctrl = require('./credits.controller');

const router = Router();

// Credits/wallet data is staff-only.
router.use(requireStaff);

router.get('/credits/transactions', ctrl.listTransactions);
router.get('/credits/users', ctrl.listUsers);
router.get('/credits/summary', ctrl.summary);

module.exports = router;
