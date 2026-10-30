const { verifyToken } = require('../utils/jwt');
const { AppError }   = require('../errors/app_error');

/**
 * requireAuth — Express middleware that verifies the Bearer JWT.
 * Attaches decoded payload to req.user on success.
 */
const requireAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(err); // JsonWebTokenError / TokenExpiredError — handled by errorHandler
  }
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

module.exports = { requireAuth, authenticate: requireAuth, adminOnly };
