const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
const {
  getCustomers,
  getCustomerById,
  getOrdersByCustomer,
  getPassword,
  resetPassword,
  blockCustomer,
  getProfile,
  updateProfile,
} = require('./customers.controller');

const router = Router();

// Mount /me endpoints before parameterized /:id routes
router.get('/me',                 authenticate, getProfile);
router.patch('/me',               authenticate, updateProfile);

router.get('/',                 authenticate, getCustomers);
router.get('/:id',              authenticate, getCustomerById);
router.get('/:id/orders',       authenticate, getOrdersByCustomer);
router.get('/:id/password',     authenticate, getPassword);
router.post('/:id/reset-password', authenticate, resetPassword);
router.patch('/:id/block',      authenticate, blockCustomer);

module.exports = router;
