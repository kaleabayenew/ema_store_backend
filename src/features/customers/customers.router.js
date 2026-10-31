const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
const { getCustomers, getCustomerById, blockCustomer } = require('./customers.controller');

const router = Router();

// All routes require admin authentication
router.get('/',       authenticate, getCustomers);
router.get('/:id',    authenticate, getCustomerById);
router.patch('/:id/block', authenticate, blockCustomer);

module.exports = router;
