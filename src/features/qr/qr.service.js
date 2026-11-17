const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../core/config');
const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// 5 minutes in seconds
const QR_TTL_SECONDS = 300;

/**
 * Generate a dynamic 5-minute signed QR token for the authenticated user.
 */
async function generateUserQrToken(userId) {
  const { rows } = await pool.query(
    'SELECT id, phone, full_name, role, is_active, is_blocked FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }
  if (!user.is_active || user.is_blocked) {
    throw new AppError('Account is inactive or suspended.', 403, 'ACCOUNT_SUSPENDED');
  }

  let shopName = null;
  if (user.role === 'PARTNER' || user.role === 'SELLER') {
    try {
      const pRes = await pool.query(
        'SELECT shop_name FROM partner_profiles WHERE partner_id = $1',
        [user.id]
      );
      shopName = pRes.rows[0]?.shop_name || null;
    } catch (_) {
      // partner_profiles might be empty or table structure variation
    }
  }

  const payload = {
    sub: user.id,
    role: user.role,
    phone: user.phone,
    name: user.full_name,
    shopName,
    type: 'USER_QR',
  };

  const token = jwt.sign(payload, jwtSecret, {
    expiresIn: QR_TTL_SECONDS,
    issuer: 'ema-store',
    audience: 'ema-qr',
  });

  const qrToken = `EMA-QR:v1:${token}`;
  const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000).toISOString();

  return {
    qrToken,
    expiresInSeconds: QR_TTL_SECONDS,
    expiresAt,
    user: {
      id: user.id,
      fullName: user.full_name,
      phone: user.phone,
      role: user.role,
      shopName,
    },
  };
}

/**
 * Verify and decrypt an encrypted QR token.
 * Returns decoded details if valid, or explains if expired / not found.
 */
async function verifyQrToken(rawQrString) {
  if (!rawQrString || typeof rawQrString !== 'string') {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'QR code string is required.',
    };
  }

  let token = rawQrString.trim();

  // Strip prefix if present
  if (token.startsWith('EMA-QR:v1:')) {
    token = token.slice('EMA-QR:v1:'.length).trim();
  } else if (token.startsWith('EMA-QR:')) {
    token = token.slice('EMA-QR:'.length).trim();
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, {
      issuer: 'ema-store',
      audience: 'ema-qr',
    });

    // Check user in database
    const { rows } = await pool.query(
      'SELECT id, phone, full_name, role, is_active, is_blocked FROM users WHERE id = $1',
      [decoded.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active || user.is_blocked) {
      return {
        valid: false,
        code: 'NOT_FOUND',
        message: 'User account not found or deactivated.',
      };
    }

    let shopName = decoded.shopName || null;
    if (!shopName && (user.role === 'PARTNER' || user.role === 'SELLER')) {
      try {
        const pRes = await pool.query(
          'SELECT shop_name FROM partner_profiles WHERE partner_id = $1',
          [user.id]
        );
        shopName = pRes.rows[0]?.shop_name || null;
      } catch (_) {}
    }

    return {
      valid: true,
      code: 'VERIFIED',
      message: 'QR code verified successfully.',
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        shopName,
      },
      verifiedAt: new Date().toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return {
        valid: false,
        code: 'EXPIRED',
        message: 'QR code expired. Please ask the user to refresh their QR code.',
        expiredAt: err.expiredAt ? new Date(err.expiredAt).toISOString() : null,
      };
    }
    return {
      valid: false,
      code: 'NOT_FOUND',
      message: 'QR code not found or invalid format.',
    };
  }
}

module.exports = {
  generateUserQrToken,
  verifyQrToken,
};
