const service = require('./orders.service');
const { isEncryptedAgentQr, decryptAgentQr } = require('../../delivery/agent_qr');

// The delivery person's QR carries an encrypted, 5-minute token. Decrypt it to
// the plain agent code; typed-in plain codes pass through unchanged.
const resolveAgentCode = (raw) =>
  isEncryptedAgentQr(raw) ? decryptAgentQr(raw) : raw;
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

const updatePaymentMethod = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const body = req.body || {};
    const method = body.paymentMethod || body.payment_method;
    if (!method) return error(res, 'paymentMethod is required.', 400, 'MISSING_FIELDS');
    const order = await service.updatePaymentMethod(partnerId, req.params.id, method);
    ok(res, { order });
  } catch (err) {
    next(err);
  }
};

// Step 1 of "Out from the shop": scanned delivery ID → who + what (no changes).
const scanHandover = async (req, res, next) => {
  try {
    const { agentCode } = req.body || {};
    if (!agentCode) return error(res, 'agentCode is required.', 400, 'MISSING_FIELDS');
    const result = await service.previewHandover(req.user.id, req.params.id, resolveAgentCode(agentCode));
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

// Step 2: partner confirms → saves proof, sets handover_requested_at, notifies rider
const confirmHandover = async (req, res, next) => {
  try {
    const { agentCode, proof, handover_proof } = req.body || {};
    if (!agentCode) return error(res, 'agentCode is required.', 400, 'MISSING_FIELDS');
    const proofData = proof || handover_proof || [];
    const order = await service.confirmHandover(
      req.user.id,
      req.params.id,
      resolveAgentCode(agentCode),
      proofData,
    );
    ok(res, { order });
  } catch (err) {
    next(err);
  }
};

module.exports = { getOrders, getOrder, updateStatus, updatePaymentMethod, scanHandover, confirmHandover };