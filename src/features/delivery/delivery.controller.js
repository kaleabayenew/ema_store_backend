const service = require('./delivery.service');
const { ok } = require('../../core/utils/response');

const agentCode = (req) => req.headers['x-agent-code'] || req.query.agentCode;

const listOffers = async (req, res, next) => {
  try {
    const result = await service.listOffers(agentCode(req));
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getQr = async (req, res, next) => {
  try {
    const result = await service.getAgentQr(agentCode(req));
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

const updateLocation = async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await service.updateAgentLocation(
      agentCode(req),
      body.lat ?? body.latitude,
      body.lng ?? body.longitude,
    );
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const result = await service.getDeliveryHistory(agentCode(req), {
      limit: req.query.limit,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getEarnings = async (req, res, next) => {
  try {
    const result = await service.getEarnings(agentCode(req));
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getActiveDelivery = async (req, res, next) => {
  try {
    const result = await service.getActiveDelivery(agentCode(req));
    ok(res, { job: result });
  } catch (err) {
    next(err);
  }
};

const confirmPickup = async (req, res, next) => {
  try {
    const result = await service.confirmPickup(agentCode(req), req.params.orderId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const markArrived = async (req, res, next) => {
  try {
    const result = await service.markArrived(agentCode(req), req.params.orderId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const scanDelivery = async (req, res, next) => {
  try {
    const { customerQrToken, proof, qrToken } = req.body || {};
    const result = await service.scanDelivery(agentCode(req), req.params.orderId, {
      customerQrToken: customerQrToken || qrToken,
      proof: proof || [],
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updateLocation,
  getQr,
  listOffers,
  acceptOffer,
  declineOffer,
  getActiveDelivery,
  getHistory,
  getEarnings,
  confirmPickup,
  scanDelivery,
  markArrived,
};