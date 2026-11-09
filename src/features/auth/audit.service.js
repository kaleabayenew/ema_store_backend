const { pool } = require('../../core/config/database');

// ─────────────────────────────────────────────────────────────────────────────
//  Auth audit log — fire-and-forget writes to auth_audit_log.
//  NEVER stores passwords, OTP codes, tokens or full phone numbers.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_EVENTS = new Set([
  'REGISTER_STARTED',
  'REGISTER_COMPLETED',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_LOCKED',
  'OTP_SENT',
  'OTP_FAILED',
  'PASSWORD_RESET',
  'TOKEN_REFRESH',
  'TOKEN_REUSE_DETECTED',
  'LOGOUT',
  'LOGOUT_ALL',
]);

const MAX_META_BYTES = 1024;

/** "+251912345678" → "+251*****5678". Returns '' for falsy input. */
function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `+${digits.slice(0, 3)}*****${digits.slice(-4)}`;
}

/**
 * logAuthEvent({ event, userId, phone, req, meta })
 * Fire-and-forget: never throws, never makes the caller wait.
 */
function logAuthEvent({ event, userId = null, phone = null, req = null, meta = null } = {}) {
  try {
    if (!ALLOWED_EVENTS.has(event)) return;

    const ip = req?.ip ? String(req.ip).slice(0, 64) : null;
    const userAgent = req?.get ? String(req.get('user-agent') || '').slice(0, 255) || null : null;

    // meta: small plain object only (≤ 1 KB as JSON), otherwise dropped.
    let metaJson = null;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      try {
        const json = JSON.stringify(meta);
        if (json.length <= MAX_META_BYTES) metaJson = json;
      } catch (_e) {
        metaJson = null;
      }
    }

    pool
      .query(
        `INSERT INTO auth_audit_log (user_id, event, phone_masked, ip, user_agent, meta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, event, maskPhone(phone), ip, userAgent, metaJson],
      )
      .catch((err) => {
        // Log only the error code — never the query params.
        console.error(`[auth-audit] insert failed (${err.code || 'UNKNOWN'})`);
      });
  } catch (_err) {
    // Audit must never break the auth flow.
  }
}

module.exports = { logAuthEvent, maskPhone };
