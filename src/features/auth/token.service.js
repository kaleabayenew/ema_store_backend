const crypto = require('crypto');
const { pool } = require('../../core/config/database');
const {
  signAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} = require('../../core/utils/jwt');
const { refreshTokenDays } = require('../../core/config');
const { AppError } = require('../../core/errors/app_error');
const { logAuthEvent } = require('./audit.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Refresh tokens — opaque random strings, stored ONLY as SHA-256 hashes.
//  Rotation: every use revites the old token and issues a new one in the same
//  family. Reuse of a rotated/revoked token revokes the WHOLE family.
// ─────────────────────────────────────────────────────────────────────────────

const sha256 = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

const ipOf = (req) => (req?.ip ? String(req.ip).slice(0, 64) : null);
const uaOf = (req) =>
  req?.get ? String(req.get('user-agent') || '').slice(0, 255) || null : null;

/** Load the account the same way requireAuth does — DB is the truth. */
async function loadUser(client, userId) {
  const { rows } = await client.query(
    `SELECT u.id, u.role, u.is_active, u.is_blocked, u.block_reason, au.admin_role
       FROM users u
       LEFT JOIN admin_user au ON au.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

function assertUsable(user) {
  if (!user) {
    throw new AppError('Account not found.', 401, 'USER_NOT_FOUND');
  }
  if (user.is_blocked || user.is_active === false) {
    throw new AppError(
      user.block_reason ||
        'Your account has been suspended by the administration. Please contact support.',
      403,
      'ACCOUNT_BLOCKED',
    );
  }
}

function accessClaims(user) {
  const role = user.admin_role || user.role;
  return { id: user.id, role, adminRole: user.admin_role || role };
}

/**
 * Issue a fresh access + refresh token pair (new family).
 * @returns {Promise<{ accessToken, refreshToken, expiresIn }>}
 */
async function issueTokens(user, req) {
  const raw = newRefreshToken();
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000,
  );

  await pool.query(
    `INSERT INTO refresh_tokens
       (id, user_id, token_hash, family_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      user.id,
      sha256(raw),
      familyId,
      expiresAt,
      uaOf(req),
      ipOf(req),
    ],
  );

  logAuthEvent({ event: 'TOKEN_REFRESH', userId: user.id, req });

  return {
    accessToken: signAccessToken(accessClaims(user)),
    refreshToken: raw,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Rotate a refresh token: revoke it and issue its replacement atomically.
 * Reuse of an already-rotated token revokes the entire family.
 * @returns {Promise<{ accessToken, refreshToken, expiresIn, userId }>}
 */
async function rotateRefreshToken(raw, req) {
  const tokenHash = sha256(raw);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, user_id, family_id, expires_at, revoked_at, created_at
         FROM refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );

    const row = rows[0];
    if (!row || new Date(row.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      throw new AppError('Invalid refresh token.', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Reuse of a rotated/revoked token → burn the whole family.
    if (row.revoked_at) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [row.family_id],
      );
      await client.query('COMMIT');
      logAuthEvent({
        event: 'TOKEN_REUSE_DETECTED',
        userId: row.user_id,
        req,
        meta: { familyId: row.family_id },
      });
      throw new AppError(
        'Refresh token reuse detected. Please sign in again.',
        401,
        'REFRESH_REUSED',
      );
    }

    // Password changed after this token was issued → session is dead.
    const { rows: pwRows } = await client.query(
      `SELECT password_changed_at FROM users WHERE id = $1`,
      [row.user_id],
    );
    const pwChangedAt = pwRows[0] && pwRows[0].password_changed_at;
    if (pwChangedAt && new Date(pwChangedAt) > new Date(row.created_at)) {
      await client.query('ROLLBACK');
      throw new AppError(
        'Session expired. Please sign in again.',
        401,
        'INVALID_TOKEN',
      );
    }

    const user = await loadUser(client, row.user_id);
    assertUsable(user);

    // Issue the replacement inside the same family.
    const newRaw = newRefreshToken();
    const newId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000,
    );

    await client.query(
      `INSERT INTO refresh_tokens
         (id, user_id, token_hash, family_id, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId, row.user_id, sha256(newRaw), row.family_id, expiresAt, uaOf(req), ipOf(req)],
    );

    await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = NOW(), replaced_by = $2
        WHERE id = $1`,
      [row.id, newId],
    );

    await client.query('COMMIT');

    logAuthEvent({ event: 'TOKEN_REFRESH', userId: row.user_id, req });

    return {
      accessToken: signAccessToken(accessClaims(user)),
      refreshToken: newRaw,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      userId: row.user_id,
    };
  } catch (err) {
    // Roll back only if we haven't already committed/rolled back.
    try {
      await client.query('ROLLBACK');
    } catch (_e) {
      /* already finished */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Revoke a single refresh token by its raw value. Unknown tokens are ignored —
 * the caller gets the same result either way (no oracle).
 */
async function revokeRefreshToken(raw) {
  if (!raw) return;
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(raw)],
  );
}

/** Revoke every active refresh token of a user (logout-all, password change). */
async function revokeAllForUser(userId) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

/** Delete refresh tokens that expired more than 7 days ago. Caller schedules it. */
async function cleanupExpiredTokens() {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < NOW() - INTERVAL '7 days'`,
  );
  return rowCount;
}

module.exports = {
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  cleanupExpiredTokens,
};
