const service = require('./delivery.service');
const { ok, error } = require('../../core/utils/response');

const agentCode = (req) => req.headers['x-agent-code'] || req.query.agentCode;

const listOffers = async (req, res, next) => {
  try {
    const result = await service.listOffers(agentCode(req));
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const acceptOffer = async (req, res, next) => {
  try {
    const result = await service.acceptOffer(agentCode(req), req.params.orderId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const declineOffer = async (req, res, next) => {
  try {
    const result = await service.declineOffer(agentCode(req), req.params.orderId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

module.exports = { listOffers, acceptOffer, declineOffer };
