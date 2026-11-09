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
    const product = await service.updateStock(partnerId, req.params.productId, parseInt(quantity));
    ok(res, { product });
  } catch (err) {
    next(err);
  }
};

module.exports = { getInventory, updateStock };
