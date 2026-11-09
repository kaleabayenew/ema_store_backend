const service = require('./orders.service');
const { ok, error } = require('../../../core/utils/response');

const getOrders = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const { page, limit, status } = req.query;
    const result = await service.getOrders(partnerId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getOrder = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const order = await service.getOrder(partnerId, req.params.id);
    ok(res, { order });
  } catch (err) {
    next(err);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const { status } = req.body;
    if (!status) return error(res, 'status is required.', 400, 'MISSING_FIELDS');
    const order = await service.updateStatus(partnerId, req.params.id, status);
    ok(res, { order });
  } catch (err) {
    next(err);
  }
};

module.exports = { getOrders, getOrder, updateStatus };
