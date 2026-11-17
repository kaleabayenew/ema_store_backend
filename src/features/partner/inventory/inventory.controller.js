const service = require('./inventory.service');
const { ok, error } = require('../../../core/utils/response');

const getInventory = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const inventory = await service.getInventory(partnerId);
    ok(res, { inventory });
  } catch (err) {
    next(err);
  }
};

const updateStock = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const { quantity } = req.body;
    if (quantity === undefined || quantity === null) {
      return error(res, 'quantity is required.', 400, 'MISSING_FIELDS');
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      return error(res, 'quantity must be a whole number, 0 or more.', 400, 'INVALID_QUANTITY');
    }
    const product = await service.updateStock(partnerId, req.params.productId, qty);
    ok(res, { product });
  } catch (err) {
    next(err);
  }
};

module.exports = { getInventory, updateStock };