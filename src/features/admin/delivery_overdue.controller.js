const deliveryService = require('../delivery/delivery.service');
const { ok } = require('../../core/utils/response');

// GET /api/v1/admin/delivery/overdue?hours=24&includeResolved=false
const listOverdue = async (req, res, next) => {
  try {
    const deliveries = await deliveryService.listOverdueDeliveries({
      hours: req.query.hours,
      includeResolved: req.query.includeResolved === 'true' || req.query.includeResolved === '1',
    });
    ok(res, { deliveries });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/admin/delivery/:orderId/reassign  { agentCode? }
// agentCode → assign to that rider; omitted → release back to offers pool.
const reassign = async (req, res, next) => {
  try {
    const result = await deliveryService.reassignDelivery(req.params.orderId, {
      agentCode: req.body?.agentCode || req.body?.agent_code || null,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

module.exports = { listOverdue, reassign };
