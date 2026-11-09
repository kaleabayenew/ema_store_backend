const service = require('./dashboard.service');
const { ok } = require('../../../core/utils/response');

const getStats = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const stats = await service.getStats(partnerId);
    ok(res, { stats });
  } catch (err) {
    next(err);
  }
};

module.exports = { getStats };
