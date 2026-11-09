const service = require('./earnings.service');
const { ok, error } = require('../../../core/utils/response');

const getEarnings = async (req, res, next) => {
  try {
    const earnings = await service.getEarnings(req.user.id);
    ok(res, { earnings });
  } catch (err) {
    next(err);
  }
};

const getTransactions = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await service.getTransactions(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const requestPayout = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount) return error(res, 'amount is required.', 400, 'MISSING_FIELDS');
    const transaction = await service.requestPayout(req.user.id, parseFloat(amount));
    ok(res, { transaction });
  } catch (err) {
    next(err);
  }
};

module.exports = { getEarnings, getTransactions, requestPayout };
