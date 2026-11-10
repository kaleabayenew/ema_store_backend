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
    const { q, role, page, limit } = req.query;
    const data = await svc.getUsers({ q, role, page, limit });
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

module.exports = { listTransactions, listUsers, adjust, summary };
