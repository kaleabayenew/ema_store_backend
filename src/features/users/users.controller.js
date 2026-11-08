const svc = require('./users.service');
const { ok, created, error } = require('../../core/utils/response');

// Only SUPER_ADMIN may manage staff users.
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return error(res, 'Super Admin access required.', 403, 'SUPER_ADMIN_ONLY');
  }
  next();
}

async function list(req, res, next) {
  try {
    const { search, role, status, page = 1, limit = 50 } = req.query;
    const result = await svc.listStaffUsers({
      search: search || undefined,
      role: role || undefined,
      status: status || undefined,
      page: parseInt(page), limit: parseInt(limit),
    });
    ok(res, result);
  } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    const user = await svc.getStaffUser(req.params.id);
    ok(res, { user });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { fullName, email, phone, password, role, allowedPages } = req.body;
    if (!password || !role) {
      return error(res, 'Password and role are required.', 400, 'MISSING_FIELDS');
    }
    const user = await svc.createStaffUser({ fullName, email, phone, password, role, allowedPages });
    created(res, { user });
  } catch (e) {
    if (e.code === 'EMAIL_TAKEN' || e.code === 'PHONE_TAKEN' || e.code === 'WEAK_PASSWORD' || e.code === 'INVALID_ROLE') {
      return error(res, e.message, e.statusCode || 400, e.code);
    }
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { fullName, email, role, allowedPages } = req.body;
    const user = await svc.updateStaffUser(req.params.id, { fullName, email, role, allowedPages });
    ok(res, { user });
  } catch (e) {
    if (e.code === 'EMAIL_TAKEN' || e.code === 'INVALID_ROLE' || e.code === 'NOT_FOUND') {
      return error(res, e.message, e.statusCode || 400, e.code);
    }
    next(e);
  }
}

async function setStatus(req, res, next) {
  try {
    const { block, reason } = req.body;
    await svc.setStaffUserStatus(req.params.id, { block: !!block, reason });
    ok(res, { message: 'Status updated' });
  } catch (e) { next(e); }
}

async function resetPassword(req, res, next) {
  try {
    const { newPassword } = req.body;
    await svc.resetStaffPassword(req.params.id, newPassword);
    ok(res, { message: 'Password reset' });
  } catch (e) {
    if (e.code === 'WEAK_PASSWORD' || e.code === 'NOT_FOUND') {
      return error(res, e.message, e.statusCode || 400, e.code);
    }
    next(e);
  }
}

module.exports = { requireSuperAdmin, list, getOne, create, update, setStatus, resetPassword };
