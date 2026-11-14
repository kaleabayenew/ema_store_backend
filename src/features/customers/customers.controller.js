const {
  listCustomers,
  getCustomer,
  getCustomerOrders,
  resetCustomerPassword,
  setCustomerBlock,
  getCustomerProfile,
  updateCustomerProfile,
} = require('./customers.service');
const { AppError } = require('../../core/errors/app_error');

async function getCustomers(req, res, next) {
  try {
    const { search = '', status = 'all', page = 1, limit = 20 } = req.query;
    const result = await listCustomers({
      search,
      status,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getCustomerById(req, res, next) {
  try {
    const customer = await getCustomer(req.params.id);
    if (!customer) return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    res.json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
}

async function getOrdersByCustomer(req, res, next) {
  try {
    const orders = await getCustomerOrders(req.params.id);
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
}

async function getPassword(req, res, next) {
  try {
    // Plain-text passwords are no longer stored or revealed. Password
    // resets go through POST /:id/reset-password which delivers the new
    // password to the customer via Telegram.
    res.status(410).json({
      success: false,
      message: 'Password reveal is disabled. Use reset-password instead.',
      code: 'PASSWORD_REVEAL_DISABLED',
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const result = await resetCustomerPassword(req.params.id);
    if (!result) return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function blockCustomer(req, res, next) {
  try {
    const { block, reason } = req.body;
    if (typeof block !== 'boolean') {
      return res.status(400).json({ success: false, message: '`block` (boolean) is required' });
    }
    const ok = await setCustomerBlock(req.params.id, block, reason);
    if (!ok) return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    res.json({ success: true, message: block ? 'Customer blocked' : 'Customer unblocked' });
  } catch (err) {
    next(err);
  }
}

async function getProfile(req, res, next) {
  try {
    const customer = await getCustomerProfile(req.user.id);
    res.json({ success: true, customer });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { fullName, avatarUrl, email } = req.body;

    if (fullName !== undefined) {
      const name = String(fullName || '').trim();
      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({ success: false, message: 'Name must be 2–100 characters' });
      }
      req.body.fullName = name;
    }
    if (email !== undefined && email !== null && email !== '') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
        return res.status(400).json({ success: false, message: 'Invalid email address' });
      }
    }
    if (avatarUrl !== undefined && avatarUrl !== null && String(avatarUrl).length > 500) {
      return res.status(400).json({ success: false, message: 'Invalid avatar URL' });
    }

    const customer = await updateCustomerProfile(req.user.id, { fullName: req.body.fullName, avatarUrl, email });
    res.json({ success: true, customer });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCustomers,
  getCustomerById,
  getOrdersByCustomer,
  getPassword,
  resetPassword,
  blockCustomer,
  getProfile,
  updateProfile,
};
