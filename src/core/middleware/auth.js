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

  if (!token) {
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }

  try {
    const decoded = verifyToken(token);
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

module.exports = { requireAuth, authenticate: requireAuth, optionalAuth, adminOnly };
