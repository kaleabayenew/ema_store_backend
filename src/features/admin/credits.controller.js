// src/features/admin/credits.controller.js

const svc = require('./credits.service');
const { ok } = require('../../core/utils/response');

async function listTransactions(req, res, next) {
  try {
    const { q, userId, role, direction, currency, status, page, limit } = req.query;
    const data = await svc.getTransactions({
      q,
      userId,
      role,
      direction,
      currency,
      status,
      page,
      limit,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const { q, role, scope, page, limit } = req.query;
    const data = await svc.getUsers({ q, role, scope, page, limit });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function adjust(req, res, next) {
  try {
    const { userId, direction, amount, note } = req.body || {};
    const data = await svc.adjustBalance({
      userId,
      direction,
      amount,
      note,
      adminId: req.user?.id ?? null,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function summary(req, res, next) {
  try {
    const data = await svc.getSummary();
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function coinRate(req, res, next) {
  try {
    const data = await svc.getCoinRate();
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function updateCoinRate(req, res, next) {
  try {
    const { coinsPerUnit } = req.body || {};
    const data = await svc.setCoinRate(coinsPerUnit);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

module.exports = { listTransactions, listUsers, adjust, summary, coinRate, updateCoinRate };
