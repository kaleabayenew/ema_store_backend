const { verifyToken } = require('../utils/jwt');
const { AppError } = require('../errors/app_error');
const { pool } = require('../config/database');

/**
 * requireAuth — Express middleware that verifies the Bearer JWT and checks account status.
 * Rejects with 403 ACCOUNT_BLOCKED if an admin has blocked the customer.
 */
const requireAuth = async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  console.log('[requireAuth] Authorization header:', header ? 'Present' : 'Missing');
  console.log('[requireAuth] Token:', token ? `${token.substring(0, 20)}...` : 'None');

  if (!token) {
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }

  try {
    const decoded = verifyToken(token);
    console.log('[requireAuth] Decoded token:', decoded);
    req.user = decoded;

    if (decoded && decoded.id) {
      const { rows } = await pool.query(
        'SELECT is_active, is_blocked, block_reason FROM users WHERE id = $1',
        [decoded.id]
      );
      if (rows.length === 0) {
        return next(new AppError('Account not found.', 401, 'USER_NOT_FOUND'));
      }
      const u = rows[0];
      if (u.is_blocked || u.is_active === false) {
        return next(new AppError(
          u.block_reason || 'Your account has been suspended by the administration. Please contact support.',
          403,
          'ACCOUNT_BLOCKED'
        ));
      }
    }

    next();
  } catch (err) {
    console.log('[requireAuth] Error:', err.message);
    next(err); // JsonWebTokenError / TokenExpiredError — handled by errorHandler
  }
};

/**
 * optionalAuth — Decodes JWT if present, but doesn't reject if missing.
 */
const optionalAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = verifyToken(token);
  } catch (err) {
    // Ignore invalid token on optional auth
  }
  next();
};

/**
 * adminOnly — Express middleware that checks if user has admin role.
 */
const adminOnly = (req, _res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return next(new AppError('Admin access required.', 403, 'ADMIN_ONLY'));
  }
  next();
};

/**
 * requireStaff — Express middleware that checks if user has any staff role.
 * Staff roles: ADMIN, SUPER_ADMIN, CUSTOMER_SUPPORT, MANAGER
 * Also checks adminRole field from admin_user table.
 */
const requireStaff = (req, _res, next) => {
  if (!req.user) {
    console.log('[requireStaff] No req.user found');
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }
  // Check adminRole first (from admin_user table), then fall back to role
  const role = String(req.user.adminRole || req.user.role || '').toUpperCase();
  console.log('[requireStaff] User role:', role, '(adminRole:', req.user.adminRole, 'role:', req.user.role, ')');
  const staffRoles = ['ADMIN', 'SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'MANAGER'];
  if (!staffRoles.includes(role)) {
    console.log('[requireStaff] Role not in staffRoles:', staffRoles);
    return next(new AppError('Staff access required.', 403, 'STAFF_ONLY'));
  }
  console.log('[requireStaff] Access granted');
  next();
};

/**
 * requireSuperAdmin — Express middleware that checks if user has SUPER_ADMIN role.
 * Checks both adminRole (from admin_user table) and role (from users table).
 */
const requireSuperAdmin = (req, _res, next) => {
  if (!req.user) {
    console.log('[requireSuperAdmin] No req.user found');
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }
  // Check adminRole first (from admin_user table), then fall back to role
  const role = String(req.user.adminRole || req.user.role || '').toUpperCase();
  console.log('[requireSuperAdmin] User role:', role, '(adminRole:', req.user.adminRole, 'role:', req.user.role, ')');
  if (role !== 'SUPER_ADMIN') {
    console.log('[requireSuperAdmin] Role is not SUPER_ADMIN');
    return next(new AppError('Super Admin access required.', 403, 'SUPER_ADMIN_ONLY'));
  }
  console.log('[requireSuperAdmin] Access granted');
  next();
};

module.exports = { requireAuth, authenticate: requireAuth, optionalAuth, adminOnly, requireStaff, requireSuperAdmin };
