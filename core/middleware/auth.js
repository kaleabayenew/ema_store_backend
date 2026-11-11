const { verifyToken } = require('../utils/jwt');
const { AppError } = require('../errors/app_error');
const { pool } = require('../config/database');

const STAFF_ROLES = [
  'ADMIN',
  'SUPER_ADMIN',
  'CUSTOMER_SUPPORT',
  'MANAGER',
  'MANAGEMENT',
  'PARTNER_MANAGER',
  'PRODUCT_MANAGER',
  'FINANCE',
  'MARKETING',
];

const roleOf = (req) =>
  String(req.user?.adminRole || req.user?.role || '').toUpperCase();

/**
 * requireAuth — verifies the Bearer JWT, then re-reads the account from the
 * database so that blocking, deactivating or changing the role of a user takes
 * effect immediately (not only when their token expires).
 *
 * Sets req.user = { ...tokenPayload, role, adminRole } where role/adminRole come
 * from the database, not from the token, and req.authVerified = true.
 *
 * TODO(revocation): to support token revocation later, add a
 * password_changed_at column to users and reject tokens whose iat is older
 * than it (compare decoded.iat * 1000 < password_changed_at).
 */
const requireAuth = async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return next(new AppError('Authentication required.', 401, 'MISSING_TOKEN'));
  }

  try {
    const decoded = verifyToken(token);

    // The id must be a plain string or number — objects/arrays are rejected.
    const idType = typeof decoded?.id;
    if (!decoded || (idType !== 'string' && idType !== 'number') || decoded.id === '') {
      return next(new AppError('Invalid or malformed token.', 401, 'INVALID_TOKEN'));
    }

    const { rows } = await pool.query(
      `SELECT u.role, u.is_active, u.is_blocked, u.block_reason, au.admin_role
         FROM users u
         LEFT JOIN admin_user au ON au.user_id = u.id
        WHERE u.id = $1`,
      [decoded.id],
    );

    if (rows.length === 0) {
      return next(new AppError('Account not found.', 401, 'USER_NOT_FOUND'));
    }

    const u = rows[0];
    if (u.is_blocked || u.is_active === false) {
      return next(
        new AppError(
          u.block_reason ||
            'Your account has been suspended by the administration. Please contact support.',
          403,
          'ACCOUNT_BLOCKED',
        ),
      );
    }

    // The database is the only source of truth for roles — never trust the
    // token's role claim. The admin role wins over the base role.
    const effectiveRole = u.admin_role || u.role;
    if (!effectiveRole) {
      return next(new AppError('Invalid or malformed token.', 401, 'INVALID_TOKEN'));
    }
    req.user = {
      ...decoded,
      role: effectiveRole,
      adminRole: u.admin_role || effectiveRole,
    };
    req.authVerified = true;

    next();
  } catch (err) {
    next(err); // JsonWebTokenError / TokenExpiredError — handled by errorHandler
  }
};

/**
 * optionalAuth — decodes the JWT if present, never rejects.
 * It only exposes the user id for personalisation; it does NOT verify the
 * account and must not be used for authorisation. req.authVerified stays unset.
 */
const optionalAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const idType = typeof decoded?.id;
    if (decoded && (idType === 'string' || idType === 'number') && decoded.id !== '') {
      req.user = { id: decoded.id };
    }
  } catch (_err) {
    // Ignore invalid token on optional auth
  }
  next();
};

/**
 * Runs requireAuth first unless the token was already fully verified
 * (req.authVerified === true), then `check`.
 */
const withAuth = (check) => (req, res, next) => {
  if (req.authVerified === true) return check(req, res, next);
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    check(req, res, next);
  });
};

/** adminOnly — ADMIN or SUPER_ADMIN. */
const adminOnly = withAuth((req, _res, next) => {
  const role = roleOf(req);
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    return next(new AppError('Admin access required.', 403, 'ADMIN_ONLY'));
  }
  next();
});

/** requireStaff — any staff role (see STAFF_ROLES). */
const requireStaff = withAuth((req, _res, next) => {
  const role = roleOf(req);
  if (!STAFF_ROLES.includes(role)) {
    return next(new AppError('Staff access required.', 403, 'STAFF_ONLY'));
  }
  next();
});

/** requireSuperAdmin — SUPER_ADMIN only. */
const requireSuperAdmin = withAuth((req, _res, next) => {
  const role = roleOf(req);
  if (role !== 'SUPER_ADMIN') {
    return next(new AppError('Super Admin access required.', 403, 'SUPER_ADMIN_ONLY'));
  }
  next();
});

/** requirePartner — PARTNER role only. */
const requirePartner = withAuth((req, _res, next) => {
  if (String(req.user?.role || '').toUpperCase() !== 'PARTNER') {
    return next(new AppError('Partner access required.', 403, 'PARTNER_ONLY'));
  }
  next();
});

module.exports = {
  requireAuth,
  authenticate: requireAuth,
  optionalAuth,
  adminOnly,
  requireStaff,
  requireSuperAdmin,
  requirePartner,
};
