const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../core/config');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// ORDER FLOW — shared schema + crypto + helper utilities
// ============================================================================

// ── Schema ──────────────────────────────────────────────────────────────────

let schemaPromise = null;

/**
 * Idempotent order-flow schema. Safe to call on every boot / lazily; the
 * promise is cached so the ALTERs run once per process.
 */
function ensureOrderFlowSchema(db = require('../../core/config/database').pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS delivery_agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_code VARCHAR(40) UNIQUE NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(30),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_requested_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_proof JSONB`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_requested_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_arrived_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_proof JSONB`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_accepted_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'PENDING'`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE`);
      // Pre-existing hand-over columns (kept in sync with partner/orders).
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(20)`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_agent_id UUID`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMP`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code VARCHAR(20)`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_accepted_at TIMESTAMP`);
      await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_delivery_code
         ON orders(delivery_code) WHERE delivery_code IS NOT NULL`,
      );
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_orders_agent_status
         ON orders(delivery_agent_id, status)`,
      );
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
      );
      await db.query(
        `CREATE TABLE IF NOT EXISTS qr_display_codes (
           code VARCHAR(12) PRIMARY KEY,
           agent_id UUID,
           expires_at TIMESTAMPTZ NOT NULL
         )`,
      );
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_qr_display_codes_agent
         ON qr_display_codes(agent_id)`,
      );
      await db.query(
        `CREATE TABLE IF NOT EXISTS user_qr_display_codes (
           code VARCHAR(12) PRIMARY KEY,
           user_id UUID,
           expires_at TIMESTAMPTZ NOT NULL
         )`,
      );
    })().catch((err) => {
      schemaPromise = null; // retry on next call
      throw err;
    });
  }
  return schemaPromise;
}

// ── Dynamic v2 tokens (AES-256-GCM) ─────────────────────────────────────────

const TOKEN_PREFIX = 'EMA-QR:v2:';
const TOKEN_TTL_MS = 5 * 60 * 1000;

function tokenKey(secret = jwtSecret) {
  return crypto.createHash('sha256').update(`ema-dyn-token:${secret || 'ema-secret-fallback'}`, 'utf8').digest();
}

function encryptDynamicToken(payload, prefix = TOKEN_PREFIX, ttlSeconds = 300, secret = jwtSecret) {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const payloadToEncrypt = {
    ...payload,
    exp: expiresAtMs,
    iat: Date.now(),
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payloadToEncrypt), 'utf8'),
    cipher.final(),
  ]);

  const token = prefix + [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');

  return {
    token,
    expiresInSeconds: ttlSeconds,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function isDynamicToken(tokenString) {
  if (typeof tokenString !== 'string') return false;
  const s = tokenString.trim();
  return s.startsWith('EMA-QR:v2:') || s.startsWith('EMA-DYN:v2:') || s.startsWith('EMA-AGENTQR:v1:');
}

function decryptDynamicToken(tokenString, secret = jwtSecret) {
  const token = String(tokenString || '').trim();

  // 1. Agent QR (v1 base64url via agent_qr key)
  if (token.startsWith('EMA-AGENTQR:v1:')) {
    const { decryptAgentQr } = require('../delivery/agent_qr');
    const code = decryptAgentQr(token);
    return { code, agentCode: code };
  }

  // 2. Dynamic v2 token (EMA-QR:v2: or EMA-DYN:v2:)
  let body = token;
  if (body.startsWith('EMA-QR:v2:')) {
    body = body.slice('EMA-QR:v2:'.length);
  } else if (body.startsWith('EMA-DYN:v2:')) {
    body = body.slice('EMA-DYN:v2:'.length);
  } else if (body.startsWith('EMA-QR:v1:')) {
    // JWT fallback
    const jwtString = body.slice('EMA-QR:v1:'.length).trim();
    try {
      const decoded = jwt.verify(jwtString, secret);
      return {
        userId: decoded.sub || decoded.userId || decoded.id,
        role: decoded.role,
        fullName: decoded.name || decoded.fullName,
        phone: decoded.phone,
        type: decoded.type || 'USER_QR',
        exp: decoded.exp ? decoded.exp * 1000 : null,
      };
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('QR code has expired. Please refresh the QR code.', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Invalid QR code.', 400, 'INVALID_QR_TOKEN');
    }
  }

  const parts = body.split('.');
  if (parts.length !== 3) {
    throw new AppError('Malformed dynamic QR token.', 400, 'INVALID_QR_TOKEN');
  }

  // Determine encoding (hex vs base64url)
  const isHex = /^[0-9a-fA-F]+$/.test(parts[0]) && parts[0].length === 24;
  const encoding = isHex ? 'hex' : 'base64url';

  let payload;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      tokenKey(secret),
      Buffer.from(parts[0], encoding),
    );
    decipher.setAuthTag(Buffer.from(parts[1], encoding));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[2], encoding)),
      decipher.final(),
    ]).toString('utf8');
    payload = JSON.parse(plaintext);
  } catch (_) {
    throw new AppError('Dynamic token is invalid or corrupted.', 401, 'INVALID_TOKEN');
  }

  const exp = Number(payload && payload.exp);
  const expMs = exp > 1e12 ? exp : exp * 1000;
  if (!Number.isFinite(expMs) || expMs <= Date.now()) {
    throw new AppError('Dynamic token has expired.', 401, 'TOKEN_EXPIRED');
  }
  return payload;
}

// ── Delivery code ───────────────────────────────────────────────────────────

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

/** Cryptographically random 6-character alphanumeric package code. */
function generateDeliveryCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

// ── Phone masking ───────────────────────────────────────────────────────────

/** +251912345678 → "+251 91 **** 678" (keeps country code + 2 digits). */
function maskPhoneNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0') && d.length === 10) d = `251${d.slice(1)}`;
  else if (!d.startsWith('251')) d = `251${d}`;
  if (d.length < 7) return '***';
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} **** ${d.slice(-3)}`;
}

// ── Delivery agent resolution ───────────────────────────────────────────────

/**
 * Resolves the calling delivery agent from `x-agent-code` (plain code, an
 * EMA-AGENTQR:v1 token, or an EMA-QR:v2 token) or a Bearer JWT carrying an
 * `agentCode`/`code` claim. Returns the delivery_agents row or null.
 */
async function resolveDeliveryAgent(req, db = require('../../core/config/database').pool) {
  let code = null;

  const raw = req.headers['x-agent-code'] || req.query.agentCode;
  if (raw) {
    const value = String(raw).trim();
    if (isDynamicToken(value)) {
      const payload = decryptDynamicToken(value);
      code = payload.agentCode || payload.agent_code || payload.code || null;
    } else {
      code = value;
    }
  } else {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret, {
          issuer: 'ema-store',
          audience: 'ema-store-app',
        });
        code = decoded.agentCode || decoded.agent_code || decoded.code || null;
      } catch (_) {
        code = null;
      }
    }
  }

  if (!code) return null;
  let normalized = String(code).trim();
  if (normalized.includes(':')) normalized = normalized.split(':').pop().trim();
  normalized = normalized.toUpperCase().slice(0, 40);
  if (!normalized) return null;

  const { rows } = await db.query(
    `SELECT id, agent_code, full_name, phone, is_active
     FROM delivery_agents WHERE agent_code = $1`,
    [normalized],
  );
  const agent = rows[0];
  if (!agent || agent.is_active === false) return null;
  return agent;
}

// ── Notifications ───────────────────────────────────────────────────────────

/** Fire-and-forget notification — never lets a push failure break a flow. */
async function safeSendNotification(userId, title, body, data = {}) {
  try {
    const { sendNotification } = require('../notifications/notifications.service');
    await sendNotification({ userId, title, body, data });
  } catch (err) {
    console.error('[notify] safeSendNotification failed:', err.message || err);
  }
}

module.exports = {
  ensureOrderFlowSchema,
  encryptDynamicToken,
  decryptDynamicToken,
  isDynamicToken,
  TOKEN_PREFIX,
  TOKEN_TTL_MS,
  generateDeliveryCode,
  maskPhoneNumber,
  maskPhone: maskPhoneNumber,
  resolveDeliveryAgent,
  safeSendNotification,
};
