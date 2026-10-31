const { listCustomers, getCustomer, setCustomerBlock } = require('./customers.service');
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

async function blockCustomer(req, res, next) {
  try {
    const { block } = req.body; // true = block, false = unblock
    if (typeof block !== 'boolean') {
      return res.status(400).json({ success: false, message: '`block` (boolean) is required' });
    }
    const ok = await setCustomerBlock(req.params.id, block);
    if (!ok) return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    res.json({ success: true, message: block ? 'Customer blocked' : 'Customer unblocked' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getCustomers, getCustomerById, blockCustomer };
