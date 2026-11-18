const crypto = require('crypto');
const { jwtSecret } = require('../../core/config');
const { AppError } = require('../../core/errors/app_error');

// The QR shown on a delivery agent's ID card carries an AES-256-GCM
// encrypted, 5-minute token instead of the plain agent code, so the code
// cannot be reused after it expires or shared outside the app.
//
// Wire format: EMA-AGENTQR:v1:<iv>.<tag>.<ciphertext>  (all base64url)
// Plain codes ("ABC123", "EMA-AGENT:ABC123") pass through unchanged.

const TOKEN_TTL_SECONDS = 300;
const PREFIX = 'EMA-AGENTQR:v1:';

let cachedKey = null;

function getKey() {
  if (!cachedKey) {
    cachedKey = crypto
      .createHash('sha256')
      .update(`ema-agent-qr:${jwtSecret}`, 'utf8')
      .digest();
  }
  return cachedKey;
}

function encryptAgentCode(agentCode) {
  const code = String(agentCode || '').trim().toUpperCase();
  if (!code) {
    throw new AppError('Delivery agent code is required.', 400, 'AGENT_CODE_REQUIRED');
  }
  const expiresAtMs = Date.now() + TOKEN_TTL_SECONDS * 1000;
  const payload = JSON.stringify({ code, exp: expiresAtMs });

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);

  const token = PREFIX + [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');

  return {
    token,
    expiresInSeconds: TOKEN_TTL_SECONDS,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function isEncryptedAgentQr(raw) {
  return typeof raw === 'string' && raw.trim().startsWith(PREFIX);
}

function decryptAgentQr(raw) {
  const token = String(raw || '').trim();
  if (!isEncryptedAgentQr(token)) {
    throw new AppError('Not an encrypted agent QR token.', 400, 'INVALID_AGENT_QR');
  }
  const parts = token.slice(PREFIX.length).split('.');
  if (parts.length !== 3) {
    throw new AppError('Malformed agent QR token.', 400, 'INVALID_AGENT_QR');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getKey(),
      Buffer.from(parts[0], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[2], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext);
    if (!payload.code || !payload.exp || payload.exp < Date.now()) {
      throw new Error('expired');
    }
    return String(payload.code).trim().toUpperCase();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Agent QR token is invalid or has expired. Ask the delivery person to refresh their QR.',
      401,
      'AGENT_QR_INVALID',
    );
  }
}


// ── Short display ID (6 chars, mixed case + digits, 5-minute validity) ──
const { pool } = require('../../core/config/database');
const DISPLAY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const DISPLAY_TTL_SECONDS = 300;

function randomDisplayCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += DISPLAY_CHARS[bytes[i] % DISPLAY_CHARS.length];
  return out;
}

// Creates a fresh 5-minute display code for the agent, replacing any
// previous unexpired one. Returns the code string.
async function createAgentDisplayCode(agentId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomDisplayCode();
    try {
      await pool.query(
        `INSERT INTO qr_display_codes (code, agent_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
        [code, agentId],
      );
      return code;
    } catch (err) {
      if (err && err.code === '23505') continue; // code collision — retry
      throw err;
    }
  }
  throw new AppError('Could not generate a display code. Try again.', 500, 'CODE_GENERATION_FAILED');
}

// Resolves a typed/scanned display code to an agent_id, or null.
async function resolveAgentDisplayCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const { rows } = await pool.query(
    `SELECT agent_id FROM qr_display_codes
     WHERE code = $1 AND expires_at > NOW() AND agent_id IS NOT NULL`,
    [code.toUpperCase()] ,
  );
  // codes are mixed-case; try exact then upper
  if (!rows[0]) {
    const r2 = await pool.query(
      `SELECT agent_id FROM qr_display_codes
       WHERE UPPER(code) = UPPER($1) AND expires_at > NOW() AND agent_id IS NOT NULL`,
      [code],
    );
    return r2.rows[0]?.agent_id || null;
  }
  return rows[0].agent_id;
}

module.exports = { encryptAgentCode, isEncryptedAgentQr, decryptAgentQr, createAgentDisplayCode, resolveAgentDisplayCode };
