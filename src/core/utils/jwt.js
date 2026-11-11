const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtSecret, accessTokenExpiresIn } = require('../config');

// ─────────────────────────────────────────────────────────────────────────────
//  Access tokens: JWT HS256, 15 minutes, issuer/audience pinned.
//  Refresh tokens are opaque and handled elsewhere — never put them here.
// ─────────────────────────────────────────────────────────────────────────────

const ISSUER = 'ema-store';
const AUDIENCE = 'ema-store-app';
const ALGORITHM = 'HS256';

/** TTL string, e.g. '15m'. Config first, then env, then default. */
const ACCESS_TOKEN_TTL =
  accessTokenExpiresIn || process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';

/** ACCESS_TOKEN_TTL parsed to seconds (supports s/m/h/d suffixes). */
function ttlToSeconds(ttl) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(ttl).trim());
  if (!m) return 900;
  const n = Number(m[1]);
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n * mult;
}
const ACCESS_TOKEN_TTL_SECONDS = ttlToSeconds(ACCESS_TOKEN_TTL);

/** Only these claims may appear in a token — everything else is dropped. */
const ALLOWED_CLAIMS = ['id', 'role', 'adminRole', 'phone', 'email', 'shopName'];

function pickClaims(payload = {}) {
  const claims = {};
  for (const key of ALLOWED_CLAIMS) {
    if (payload[key] !== undefined) claims[key] = payload[key];
  }
  return claims;
}

/**
 * Sign an access token for a user.
 * @param {{ id: string, phone?: string, email?: string, role: string, adminRole?: string }} payload
 * @param {{ expiresIn?: string }} [options] lifetime override. Customers use the
 *   default (15 min + refresh token). The partner app has no refresh flow yet,
 *   so it passes a longer lifetime explicitly.
 * @returns {string} signed JWT
 */
const signAccessToken = (payload, { expiresIn } = {}) =>
  jwt.sign(pickClaims(payload), jwtSecret, {
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: expiresIn || ACCESS_TOKEN_TTL,
    jwtid: crypto.randomUUID(),
  });

// Backwards-compatible alias for existing callers.
const signToken = signAccessToken;

/**
 * Verify and decode an access token.
 * Only HS256 tokens issued by "ema-store" for "ema-store-app" are accepted —
 * "alg: none" and wrong issuer/audience tokens are rejected.
 * Throws JsonWebTokenError / TokenExpiredError on failure.
 * @param {string} token
 */
const verifyToken = (token) =>
  jwt.verify(token, jwtSecret, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });

module.exports = {
  signAccessToken,
  signToken,
  verifyToken,
  ACCESS_TOKEN_TTL_SECONDS,
};
