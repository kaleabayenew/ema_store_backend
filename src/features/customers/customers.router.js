const { Router } = require('express');
const { authenticate, requireStaff } = require('../../core/middleware/auth');
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

// Customer administration is staff-only — never expose to end users.
router.get('/',                 requireStaff, getCustomers);
router.get('/:id',              requireStaff, getCustomerById);
router.get('/:id/orders',       requireStaff, getOrdersByCustomer);
router.get('/:id/password',     requireStaff, getPassword);
router.post('/:id/reset-password', requireStaff, resetPassword);
router.patch('/:id/block',      requireStaff, blockCustomer);

module.exports = router;
