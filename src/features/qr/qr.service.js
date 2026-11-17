const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../core/config');
const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { encryptDynamicToken, decryptDynamicToken } = require('../orders/order_flow');

// 5 minutes in seconds
const QR_TTL_SECONDS = 300;

/**
 * Generate a dynamic 5-minute encrypted AES-256-GCM QR token for the authenticated user.
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
    userId: user.id,
    role: user.role,
    phone: user.phone,
    name: user.full_name,
    shopName,
    type: 'USER_QR',
  };

  const { token, expiresInSeconds, expiresAt } = encryptDynamicToken(
    payload,
    'EMA-QR:v2:',
    QR_TTL_SECONDS,
  );

  return {
    qrToken: token,
    expiresInSeconds,
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

  try {
    let targetUserId = null;
    let shopName = null;
    let expiresAt = null;

    if (token.startsWith('EMA-QR:v2:') || token.startsWith('EMA-DYN:v2:')) {
      const payload = decryptDynamicToken(token);
      targetUserId = payload.sub || payload.userId || payload.id;
      shopName = payload.shopName || null;
      expiresAt = payload.exp ? new Date(payload.exp).toISOString() : null;
    } else if (token.startsWith('EMA-AGENTQR:v1:')) {
      const { decryptAgentQr } = require('../delivery/agent_qr');
      const agentCode = decryptAgentQr(token);
      const { rows } = await pool.query(
        'SELECT id, agent_code, full_name, phone, is_active FROM delivery_agents WHERE agent_code = $1',
        [agentCode]
      );
      const agent = rows[0];
      if (!agent || agent.is_active === false) {
        return {
          valid: false,
          code: 'NOT_FOUND',
          message: 'Delivery agent not found or inactive.',
        };
      }
      return {
        valid: true,
        code: 'VERIFIED',
        message: 'Delivery agent QR verified successfully.',
        agent: {
          id: agent.id,
          code: agent.agent_code,
          name: agent.full_name,
          phone: agent.phone,
        },
        verifiedAt: new Date().toISOString(),
      };
    } else {
      // Legacy JWT v1 fallback
      let jwtToken = token;
      if (jwtToken.startsWith('EMA-QR:v1:')) {
        jwtToken = jwtToken.slice('EMA-QR:v1:'.length).trim();
      } else if (jwtToken.startsWith('EMA-QR:')) {
        jwtToken = jwtToken.slice('EMA-QR:'.length).trim();
      }

      const decoded = jwt.verify(jwtToken, jwtSecret, {
        issuer: 'ema-store',
        audience: 'ema-qr',
      });
      targetUserId = decoded.sub;
      shopName = decoded.shopName || null;
      expiresAt = decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null;
    }

    if (!targetUserId) {
      return {
        valid: false,
        code: 'INVALID_QR_TOKEN',
        message: 'No user identified in QR code.',
      };
    }

    // Check user in database
    const { rows } = await pool.query(
      'SELECT id, phone, full_name, role, is_active, is_blocked FROM users WHERE id = $1',
      [targetUserId]
    );
    const user = rows[0];

    if (!user || !user.is_active || user.is_blocked) {
      return {
        valid: false,
        code: 'NOT_FOUND',
        message: 'User account not found or deactivated.',
      };
    }

    if (!shopName && (user.role === 'PARTNER' || user.role === 'SELLER')) {
      try {
        const pRes = await pool.query(
          'SELECT shop_name FROM partner_profiles WHERE partner_id = $1',
          [user.id]
        );
        shopName = pRes.rows[0]?.shop_name || null;
      } catch (_) { }
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
      expiresAt,
    };
  } catch (err) {
    if (err.code === 'TOKEN_EXPIRED' || err.name === 'TokenExpiredError' || err.message?.includes('expired')) {
      return {
        valid: false,
        code: 'EXPIRED',
        message: 'QR code expired. Please ask the user to refresh their QR code.',
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
